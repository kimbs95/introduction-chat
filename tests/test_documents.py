import json
import shutil
import struct
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from extract import extract, hwp_records, hwp_paragraph
from build import build, chunks

ROOT = Path(__file__).resolve().parents[1]


def write_hwp_fixture(path, text, flags=1):
    """HWP parser 통합 검증용 최소 OLE/CFB 파일. 스트림은 일반 FAT를 사용한다."""
    free, end, fat = 0xffffffff, 0xfffffffe, 0xfffffffd
    header = bytearray(512)
    header[:8] = bytes.fromhex("d0cf11e0a1b11ae1")
    struct.pack_into("<HHHHH", header, 24, 0x3e, 3, 0xfffe, 9, 6)
    struct.pack_into("<IIIIIIIII", header, 40, 0, 1, 0, 0, 4096, end, 0, end, 0)
    struct.pack_into("<109I", header, 76, 1, *([free] * 108))
    def entry(name, kind, child=free, right=free, start=end, size=0):
        row = bytearray(128)
        encoded = (name + "\x00").encode("utf-16le")
        row[:len(encoded)] = encoded
        struct.pack_into("<HBBIII", row, 64, len(encoded), kind, 1, free, right, child)
        struct.pack_into("<IQ", row, 116, start, size)
        return row
    directory = b"".join([
        entry("Root Entry", 5, child=1),
        entry("FileHeader", 2, right=2, start=2, size=4096),
        entry("BodyText", 1, child=3),
        entry("Section0", 2, start=10, size=4096),
    ])
    table = [free] * 128
    table[0], table[1] = end, fat
    for start in (2, 10):
        for i in range(start, start + 7):
            table[i] = i + 1
        table[start + 7] = end
    file_header = bytearray(4096)
    file_header[:17] = b"HWP Document File"
    struct.pack_into("<II", file_header, 32, 0x05000300, flags)
    paragraph = text.encode("utf-16le")
    record = struct.pack("<I", (len(paragraph) << 20) | 67) + paragraph
    if flags & 1:
        compressor = zlib.compressobj(wbits=-15)
        record = compressor.compress(record) + compressor.flush()
    else:
        padding = 4096 - len(record) - 4
        record += struct.pack('<I', padding << 20) + b'\x00' * padding
    body = record.ljust(4096, b"\x00")
    path.write_bytes(header + directory + struct.pack("<128I", *table) + file_header + body)


class DocumentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_xlsx_keeps_headers_excludes_hidden_and_formulas(self):
        from openpyxl import Workbook
        book = Workbook()
        sheet = book.active
        sheet.title = "경력"
        sheet.append(["질문", "답변", "비공개"])
        sheet.append(["기술", "Java Spring", "SECRET COLUMN"])
        sheet.append(["숨김", "SECRET ROW", ""])
        sheet.append(["수식", '=HYPERLINK("https://example.com", "SECRET FORMULA")', ""])
        sheet.column_dimensions['C'].hidden = True
        sheet.row_dimensions[3].hidden = True
        private = book.create_sheet("비공개")
        private.sheet_state = "hidden"
        private.append(["SECRET SHEET"])
        path = self.root / "resume.xlsx"
        book.save(path)
        result = extract(path)
        text = str(result)
        self.assertIn("답변: Java Spring", text)
        self.assertIn("경력 · 2행", text)
        self.assertNotIn("SECRET", text)

    def test_hwpx_nested_table_and_section_order(self):
        path = self.root / "resume.hwpx"
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr("Contents/section2.xml", '<s xmlns:hp="urn:h"><hp:p><hp:run><hp:t>두번째</hp:t></hp:run></hp:p></s>')
            archive.writestr("Contents/section0.xml", '<s xmlns:hp="urn:h"><hp:p><hp:run><hp:t>백엔드</hp:t><hp:tbl><hp:p><hp:run><hp:t>Java</hp:t></hp:run></hp:p></hp:tbl></hp:run></hp:p></s>')
        parts = extract(path)
        self.assertEqual([p[1] for p in parts], ["백엔드", "Java", "두번째"])

    def test_docx_ignores_deleted_hidden_text(self):
        path = self.root / "resume.docx"
        xml = '<w:document xmlns:w="urn:w"><w:p><w:r><w:t>공개</w:t></w:r><w:del><w:r><w:t>SECRET DELETED</w:t></w:r></w:del><w:r><w:rPr><w:vanish/></w:rPr><w:t>SECRET HIDDEN</w:t></w:r></w:p></w:document>'
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr("word/document.xml", xml)
        self.assertEqual(extract(path)[0][1], "공개")

    def test_xml_external_entities_rejected(self):
        path = self.root / "bad.hwpx"
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr("Contents/section0.xml", '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><p>&xxe;</p>')
        with self.assertRaises(Exception):
            extract(path)

    def test_real_hwp_ole_compressed_and_plain(self):
        for flags in (0, 1):
            path = self.root / f"resume{flags}.hwp"
            write_hwp_fixture(path, "김병성은 Java 백엔드 개발자입니다.\r", flags)
            self.assertIn("Java 백엔드", extract(path)[0][1])

    def test_encrypted_and_distribution_hwp_rejected(self):
        for flags in (3, 5):
            path = self.root / f"private{flags}.hwp"
            write_hwp_fixture(path, "SECRET", flags)
            with self.assertRaisesRegex(ValueError, "암호 또는 배포용"):
                extract(path)

    def test_hwp_controls_extended_records_corruption(self):
        text = "Java".encode('utf-16le') + struct.pack('<8H', 9, 0, 0, 0, 0, 0, 0, 9) + "Spring\r".encode('utf-16le')
        self.assertEqual(hwp_paragraph(text), "Java\tSpring")
        record = struct.pack('<II', (0xfff << 20) | 67, len(text)) + text
        self.assertEqual(hwp_records(record), ["Java\tSpring"])
        with self.assertRaises(ValueError):
            hwp_records(record[:-1])

    def test_cp949_csv(self):
        path = self.root / "resume.csv"
        path.write_bytes('항목,내용\n기술,자바와 스프링\n'.encode('cp949'))
        self.assertIn("내용: 자바와 스프링", extract(path)[0][1])

    def test_blank_document_fails(self):
        path = self.root / "blank.txt"
        path.write_text(" ", encoding='utf-8')
        with self.assertRaises(ValueError):
            extract(path)

    def test_chunking_does_not_lose_content(self):
        text = "테스트문장" * 500
        pieces = list(chunks(text))
        self.assertTrue(all(len(p) <= 800 for p in pieces))
        restored = pieces[0] + ''.join(p[100:] for p in pieces[1:])
        self.assertEqual(restored, text)

    def test_build_removal_and_public_allowlist(self):
        shutil.copytree(ROOT / 'web', self.root / 'web')
        (self.root / 'content/documents').mkdir(parents=True)
        profile = json.loads((ROOT / 'content/profile.json').read_text())
        profile['fullName'] = '홍길동'
        profile['aliases'] = ['길동', '테스터']
        profile['private_note'] = 'SECRET-DO-NOT-PUBLISH'
        profile['links']['private_note'] = 'SECRET-DO-NOT-PUBLISH'
        profile['focus'][0]['private_note'] = 'SECRET-DO-NOT-PUBLISH'
        (self.root / 'content/profile.json').write_text(json.dumps(profile), encoding='utf-8')
        document = self.root / 'content/documents/old.txt'
        document.write_text('삭제할 과거 경력', encoding='utf-8')
        first = build(self.root)
        name_record = next(x for x in first['chunks'] if x['source'] == '프로필' and x['location'] == '이름')
        self.assertIn('홍길동', name_record['text'])
        self.assertIn('길동, 테스터', name_record['text'])
        self.assertTrue(any('과거 경력' in x['text'] for x in first['chunks']))
        self.assertNotIn('SECRET-DO-NOT-PUBLISH', (self.root / 'dist/data/profile.json').read_text())
        self.assertFalse((self.root / 'dist/content').exists())
        document.unlink()
        del profile['fullName'], profile['aliases']
        (self.root / 'content/profile.json').write_text(json.dumps(profile), encoding='utf-8')
        second = build(self.root)
        self.assertFalse(any('홍길동' in x['text'] for x in second['chunks']))
        self.assertFalse(any('과거 경력' in x['text'] for x in second['chunks']))
        self.assertNotEqual(first['version'], second['version'])


if __name__ == '__main__':
    unittest.main()

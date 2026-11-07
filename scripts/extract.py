"""공개 문서를 텍스트로 변환. 암호화/손상 문서는 조용히 무시하지 않는다."""
from __future__ import annotations

import csv
import io
import re
import struct
import zipfile
import zlib
from pathlib import Path

from defusedxml import ElementTree as ET

MAX_FILE = 10 * 1024 * 1024
MAX_EXPANDED = 40 * 1024 * 1024
MAX_TEXT = 1_000_000
SUPPORTED = {".md", ".txt", ".csv", ".xlsx", ".xls", ".hwp", ".hwpx", ".docx", ".pdf"}


def clean(text: str) -> str:
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    return re.sub(r"\n{3,}", "\n\n", text.replace("\r\n", "\n").replace("\r", "\n")).strip()


def decode(raw: bytes) -> str:
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    for encoding in ("utf-8-sig", "cp949"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("텍스트 인코딩을 읽을 수 없습니다. UTF-8로 저장하세요.")


def safe_zip(path: Path) -> zipfile.ZipFile:
    archive = zipfile.ZipFile(path)
    entries = archive.infolist()
    if len(entries) > 4000 or sum(x.file_size for x in entries) > MAX_EXPANDED:
        archive.close()
        raise ValueError("압축 해제 크기 제한(40MB)을 초과했습니다.")
    if any(x.flag_bits & 1 for x in entries):
        archive.close()
        raise ValueError("암호화된 ZIP 문서는 지원하지 않습니다.")
    return archive


def table_rows(rows, label):
    """첫 행을 헤더로 사용해 각 행에도 열의 의미를 보존한다."""
    headers = None
    parts = []
    for row_no, row in rows:
        values = [clean(str(v)) if v is not None else "" for v in row]
        if not any(values):
            continue
        if headers is None:
            headers = [v or f"열{i + 1}" for i, v in enumerate(values)]
            continue
        text = " | ".join(f"{headers[i] if i < len(headers) else f'열{i + 1}'}: {v}"
                          for i, v in enumerate(values) if v)
        parts.append((f"{label} · {row_no}행", text))
    return parts


def xlsx(path):
    from openpyxl import load_workbook
    with safe_zip(path):
        pass
    book = load_workbook(path, data_only=False, keep_links=False)
    parts = []
    try:
        for sheet in book:
            if sheet.sheet_state != "visible":
                continue
            if sheet.max_row * sheet.max_column > 250_000:
                raise ValueError("시트당 25만 셀 제한을 초과했습니다.")
            hidden_columns = set()
            for dim in sheet.column_dimensions.values():
                if dim.hidden:
                    hidden_columns.update(range(dim.min, dim.max + 1))
            rows = []
            for index, row in enumerate(sheet.iter_rows(), 1):
                if sheet.row_dimensions[index].hidden:
                    continue
                values = [c.value if c.data_type != "f" else None
                          for c in row if c.column not in hidden_columns]
                rows.append((index, values))
            parts.extend(table_rows(rows, sheet.title))
    finally:
        book.close()
    return parts


def xls(path):
    import xlrd
    book = xlrd.open_workbook(str(path), formatting_info=True, on_demand=True)
    parts = []
    try:
        for sheet in book.sheets():
            if sheet.visibility:
                continue
            if sheet.nrows * sheet.ncols > 250_000:
                raise ValueError("시트당 25만 셀 제한을 초과했습니다.")
            rows = []
            for i in range(sheet.nrows):
                if getattr(sheet.rowinfo_map.get(i), "hidden", False):
                    continue
                values = []
                for j in range(sheet.ncols):
                    if getattr(sheet.colinfo_map.get(j), "hidden", False):
                        continue
                    cell = sheet.cell(i, j)
                    value = cell.value
                    if cell.ctype == xlrd.XL_CELL_DATE:
                        value = xlrd.xldate_as_datetime(value, book.datemode).isoformat(sep=" ")
                    elif cell.ctype == xlrd.XL_CELL_NUMBER and float(value).is_integer():
                        value = int(value)
                    values.append(value)
                rows.append((i + 1, values))
            parts.extend(table_rows(rows, sheet.name))
    finally:
        book.release_resources()
    return parts


def hwp_paragraph(raw: bytes) -> str:
    if len(raw) % 2:
        raise ValueError("손상된 HWP 문단입니다.")
    # HWP 5 명세: inline/extended 컨트롤은 8 WCHAR, 단순 문자는 1 WCHAR.
    wide_controls = {1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23}
    output = bytearray()
    offset = 0
    while offset < len(raw):
        code = struct.unpack_from("<H", raw, offset)[0]
        if code < 32:
            output.extend(("\t" if code == 9 else "\n" if code in (10, 13) else " ").encode("utf-16le"))
            step = 16 if code in wide_controls else 2
            if offset + step > len(raw):
                raise ValueError("손상된 HWP 컨트롤입니다.")
            offset += step
        else:
            output.extend(raw[offset:offset + 2])
            offset += 2
    return clean(output.decode("utf-16le"))


def hwp_records(raw: bytes):
    parts, offset = [], 0
    while offset < len(raw):
        if offset + 4 > len(raw):
            raise ValueError("손상된 HWP 레코드입니다.")
        header = struct.unpack_from("<I", raw, offset)[0]
        offset += 4
        tag, size = header & 0x3ff, header >> 20
        if size == 0xfff:
            if offset + 4 > len(raw):
                raise ValueError("손상된 HWP 확장 레코드입니다.")
            size = struct.unpack_from("<I", raw, offset)[0]
            offset += 4
        if offset + size > len(raw):
            raise ValueError("HWP 레코드 길이가 잘못되었습니다.")
        if tag == 67:
            text = hwp_paragraph(raw[offset:offset + size])
            if text:
                parts.append(text)
        offset += size
    return parts


def hwp(path):
    import olefile
    if not olefile.isOleFile(path):
        raise ValueError("일반 HWP 5.x 파일만 지원합니다. HWPX로 다시 저장하세요.")
    parts, expanded = [], 0
    with olefile.OleFileIO(path) as doc:
        header = doc.openstream("FileHeader").read(256)
        if len(header) < 40 or not header.startswith(b"HWP Document File") or header[35] != 5:
            raise ValueError("HWP 5.x 파일이 아닙니다.")
        flags = struct.unpack_from("<I", header, 36)[0]
        if flags & 6:
            raise ValueError("암호 또는 배포용 HWP는 지원하지 않습니다. 일반 HWPX로 저장하세요.")
        sections = sorted((s for s in doc.listdir() if len(s) == 2 and s[0] == "BodyText"
                           and re.fullmatch(r"Section\d+", s[1])), key=lambda s: int(s[1][7:]))
        for section in sections:
            raw = doc.openstream(section).read(MAX_EXPANDED + 1)
            if flags & 1:
                decompressor = zlib.decompressobj(-15)
                raw = decompressor.decompress(raw, MAX_EXPANDED + 1)
                if not decompressor.eof or decompressor.unconsumed_tail:
                    raise ValueError("HWP 압축 해제 실패 또는 크기 제한 초과입니다.")
            expanded += len(raw)
            if expanded > MAX_EXPANDED:
                raise ValueError("HWP 압축 해제 크기 제한을 초과했습니다.")
            for i, text in enumerate(hwp_records(raw), 1):
                parts.append((f"구역 {int(section[1][7:]) + 1} · 문단 {i}", text))
    return parts


def xml_paragraphs(raw, kind):
    root = ET.fromstring(raw)
    paragraphs = []
    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] != "p":
            continue
        # 표/텍스트박스 내부 문단은 별도로 추출하여 중복을 피한다.
        def walk(node):
            for child in node:
                local = child.tag.rsplit("}", 1)[-1]
                if local == "p" or local in {"del", "moveFrom"}:
                    continue
                if kind == "docx" and local == "r" and any(
                    n.tag.rsplit("}", 1)[-1] in {"vanish", "webHidden"} for n in child.iter()
                ):
                    continue
                if local == "t":
                    yield "".join(child.itertext())
                elif local in {"tab", "lineBreak", "br", "cr"}:
                    yield " "
                else:
                    yield from walk(child)
        text = clean("".join(walk(element)))
        if text:
            paragraphs.append(text)
    return paragraphs


def xml_document(path):
    parts = []
    with safe_zip(path) as archive:
        if path.suffix.lower() == ".docx":
            names = ["word/document.xml"]
            kind = "docx"
        else:
            names = sorted((n for n in archive.namelist() if re.fullmatch(r"Contents/section\d+\.xml", n)),
                           key=lambda n: int(re.search(r"section(\d+)", n)[1]))
            kind = "hwpx"
        if not names:
            raise ValueError("문서 본문을 찾지 못했습니다.")
        for index, name in enumerate(names, 1):
            for number, text in enumerate(xml_paragraphs(archive.read(name), kind), 1):
                parts.append((f"구역 {index} · 문단 {number}", text))
    return parts


def extract(path: Path):
    if path.is_symlink() or path.stat().st_size > MAX_FILE:
        raise ValueError("심볼릭 링크 또는 10MB를 초과하는 파일은 지원하지 않습니다.")
    ext = path.suffix.lower()
    if ext not in SUPPORTED:
        raise ValueError(f"지원하지 않는 확장자: {ext}")
    if ext in {".md", ".txt"}:
        text = decode(path.read_bytes())
        parts = [(f"문단 {i}", s) for i, s in enumerate(re.split(r"\n\s*\n", text), 1)]
    elif ext == ".csv":
        parts = table_rows(enumerate(csv.reader(io.StringIO(decode(path.read_bytes()))), 1), "CSV")
    elif ext == ".xlsx":
        parts = xlsx(path)
    elif ext == ".xls":
        parts = xls(path)
    elif ext == ".hwp":
        parts = hwp(path)
    elif ext in {".hwpx", ".docx"}:
        parts = xml_document(path)
    else:
        from pypdf import PdfReader
        doc = PdfReader(path)
        if doc.is_encrypted:
            raise ValueError("암호화 PDF는 지원하지 않습니다.")
        if len(doc.pages) > 200:
            raise ValueError("PDF는 200쪽 이하만 지원합니다.")
        parts = [(f"{i}쪽", p.extract_text() or "") for i, p in enumerate(doc.pages, 1)]
    parts = [(label, clean(text)) for label, text in parts if clean(text)]
    if not parts:
        raise ValueError("추출된 텍스트가 없습니다. 스캔·이미지는 OCR 후 텍스트 문서로 저장하세요.")
    if sum(len(t) for _, t in parts) > MAX_TEXT:
        raise ValueError("파일당 텍스트 100만 자 제한을 초과했습니다.")
    return parts

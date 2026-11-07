"""문서를 읽고 GitHub Pages의 검색 자료를 생성한다."""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from extract import extract, SUPPORTED

ROOT = Path(__file__).resolve().parents[1]


def chunks(text, size=800, overlap=100):
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            boundary = max(text.rfind("\n", start + size // 2, end), text.rfind(". ", start + size // 2, end))
            if boundary > start:
                end = boundary + 1
        yield text[start:end].strip()
        if end == len(text):
            break
        start = end - overlap


def profile_sections(profile):
    identity = []
    if profile.get("fullName"):
        identity.append(f"본명 · {profile['fullName']}")
    identity.append(f"공개 이름 · {profile['name']}")
    if profile.get("aliases"):
        identity.append("다른 이름과 표기 · " + ", ".join(profile["aliases"]))
    sections = [("이름", "\n".join(identity)),
                ("소개", f"{profile['name']}\n역할: {profile['role']}\n{profile['summary']}"),
                ("기술", "주요 기술: " + ", ".join(profile.get("skills", [])))]
    for item in profile.get("focus", []):
        sections.append((item["title"], f"{item['title']}: {item['text']}\n{item['description']}"))
    for label, value in profile.get("links", {}).items():
        if value:
            sections.append((label, f"{label}: {value}"))
    return sections


def build(root=ROOT):
    profile = json.loads((root / "content/profile.json").read_text(encoding="utf-8"))
    for key in ("name", "role", "summary", "headline", "eyebrow"):
        if not isinstance(profile.get(key), str) or not profile[key].strip():
            raise ValueError(f"profile.json의 {key} 값을 입력하세요.")
    if "fullName" in profile and not isinstance(profile["fullName"], str):
        raise ValueError("profile.json의 fullName은 문자열이어야 합니다.")
    for key in ("skills", "questions", "aliases"):
        if not isinstance(profile.get(key, []), list) or any(not isinstance(v, str) for v in profile.get(key, [])):
            raise ValueError(f"profile.json의 {key}는 문자열 배열이어야 합니다.")
    if not isinstance(profile.get("focus", []), list) or any(
        not isinstance(item, dict) or any(not isinstance(item.get(k), str) for k in ("title", "text", "description"))
        for item in profile.get("focus", [])
    ):
        raise ValueError("profile.json의 focus에는 title, text, description을 문자열로 입력하세요.")
    if not isinstance(profile.get("links", {}), dict) or any(not isinstance(v, str) for v in profile.get("links", {}).values()):
        raise ValueError("profile.json의 links는 문자열 값을 가진 객체여야 합니다.")
    # 프런트엔드에는 문서화한 공개 키만 포함한다. 알 수 없는 설정/비밀은 복사하지 않는다.
    public_keys = ("name", "fullName", "aliases", "role", "summary", "headline", "eyebrow", "skills", "questions")
    public_profile = {k: profile[k] for k in public_keys if k in profile}
    public_profile["focus"] = [{k: item[k] for k in ("title", "text", "description")} for item in profile.get("focus", [])]
    public_profile["links"] = {k: profile.get("links", {})[k] for k in ("github", "email", "blog") if k in profile.get("links", {})}
    records, documents = [], []

    def append_document(name, ext, parts):
        doc_id = hashlib.sha256(name.encode()).hexdigest()[:12]
        count = 0
        for location, text in parts:
            for piece in chunks(text):
                if not piece:
                    continue
                count += 1
                records.append({"id": f"{doc_id}-{count}", "documentId": doc_id, "source": name,
                                "location": location, "text": piece})
        documents.append({"id": doc_id, "name": name, "type": ext, "chunks": count})

    append_document("프로필", "profile", profile_sections(public_profile))
    documents_dir = root / "content/documents"
    file_count = 0
    for path in sorted(documents_dir.rglob("*")):
        if any(part.startswith((".", "~$")) for part in path.relative_to(documents_dir).parts):
            continue
        if path.is_symlink():
            raise ValueError(f"심볼릭 링크는 허용하지 않습니다: {path.name}")
        if not path.is_file():
            continue
        file_count += 1
        if file_count > 100:
            raise ValueError("자료 파일은 100개 이하로 관리하세요.")
        if path.suffix.lower() not in SUPPORTED:
            raise ValueError(f"지원하지 않는 자료 파일: {path.name}. 지원 파일만 documents에 넣으세요.")
        try:
            append_document(path.relative_to(documents_dir).as_posix(), path.suffix[1:].lower(), extract(path))
        except Exception as error:
            raise ValueError(f"{path.name}: {error}") from error
    if len(records) > 3000:
        raise ValueError("공개 이력서 자료는 3,000개 텍스트 조각 이하로 관리하세요.")
    serialized = json.dumps(records, ensure_ascii=False, separators=(",", ":"))
    if len(serialized.encode()) > 4 * 1024 * 1024:
        raise ValueError("공개 지식 데이터 4MB 제한을 초과했습니다.")
    knowledge = {"version": hashlib.sha256(serialized.encode()).hexdigest()[:16],
                 "updatedAt": datetime.now(timezone.utc).isoformat(),
                 "documents": documents, "chunks": records}
    dist = root / "dist"
    if dist.exists():
        shutil.rmtree(dist)
    shutil.copytree(root / "web", dist)
    (dist / "data").mkdir()
    (dist / "data/profile.json").write_text(json.dumps(public_profile, ensure_ascii=False, indent=2), encoding="utf-8")
    (dist / "data/knowledge.json").write_text(json.dumps(knowledge, ensure_ascii=False), encoding="utf-8")
    (dist / ".nojekyll").touch()
    print(f"완료: 자료 {len(documents)}개, 텍스트 조각 {len(records)}개 → dist/")
    return knowledge


if __name__ == "__main__":
    try:
        build()
    except Exception as error:
        print(f"빌드 중단: {error}", file=sys.stderr)
        sys.exit(1)

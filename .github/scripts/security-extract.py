"""Extract only the exact, regular npm contract files. Never trust tar paths/links."""
import json
import pathlib
import sys
import tarfile


def main():
    archive, destination, contract = sys.argv[1:]
    expected = set(json.loads(pathlib.Path(contract).read_text(encoding="utf-8")))
    root = pathlib.Path(destination)
    if root.exists():
        raise ValueError("Extraction target must be new")
    root.mkdir()
    found = set()
    total = 0
    with tarfile.open(archive, "r:gz") as package:
        for member in package:
            name = member.name
            if not name.startswith("package/") or "\\" in name or ":" in name:
                raise ValueError("Unsafe path")
            relative = name[len("package/"):]
            if relative not in expected or relative in found or not member.isfile():
                raise ValueError("Unexpected, duplicate, or non-regular entry")
            if any(part in ("", ".", "..") for part in relative.split("/")):
                raise ValueError("Unsafe path")
            total += member.size
            if member.size > 20 * 1024 * 1024 or total > 100 * 1024 * 1024:
                raise ValueError("Package exceeds security scan limits")
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            source = package.extractfile(member)
            if source is None:
                raise ValueError("Missing entry data")
            data = source.read(member.size + 1)
            if len(data) != member.size:
                raise ValueError("Invalid entry size")
            target.write_bytes(data)
            found.add(relative)
    if found != expected:
        raise ValueError("Missing required files")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Release archive rejected; details withheld to protect sensitive paths.", file=sys.stderr)
        sys.exit(1)

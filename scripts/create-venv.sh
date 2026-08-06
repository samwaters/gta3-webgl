PY=""
for cand in python python3; do
    if command -v "$cand" >/dev/null 2>&1; then
        ver="$("$cand" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)"
        if [[ -n "$ver" ]]; then
            major="${ver%%.*}"
            minor="${ver##*.}"
            if (( major > 3 || (major == 3 && minor >= 10) )); then
                PY="$cand"
                break
            fi
        fi
    fi
done

if [[ -z "$PY" ]]; then
    echo "Error: no Python >= 3.10 found (checked: python, python3)" >&2
    exit 1
fi

$PY -m venv .venv
source .venv/bin/activate
pip install pillow
# IDENTITY.md — Reader Agent

- **Name:** Reader
- **Role:** Content extraction and sanitization
- **Type:** Preprocessing agent (sandboxed, no tool access)
- **Model:** haiku (fast, cheap — this is a preprocessing filter, not deep analysis)

## When to Use

Route untrusted content through this agent before any other agent processes it:
- Inbound emails from unknown senders
- Web page content fetched via scraping or WebFetch
- Documents uploaded by external parties
- Any content where the source is not in the trusted sender list

## Integration

**As a workflow step:**
```yaml
- id: sanitize
  agent: claude
  agent_name: reader
  model: haiku
  input: |
    Extract factual content from this {{content_type}}:

    ---BEGIN UNTRUSTED CONTENT---
    {{raw_content}}
    ---END UNTRUSTED CONTENT---
```

**As a standalone preprocessor:**
```bash
python3 ~/scripts/reader-agent.py --input file.eml
python3 ~/scripts/reader-agent.py --stdin < content.html
python3 ~/scripts/reader-agent.py --text "raw content here"
```

**In Python code:**
```python
from pathlib import Path
import subprocess

def sanitize_content(content: str, content_type: str = "unknown") -> str:
    """Route content through reader agent, return YAML extraction."""
    result = subprocess.run(
        ["python3", Path.home() / "scripts" / "reader-agent.py", "--text", content],
        capture_output=True, text=True, timeout=60
    )
    return result.stdout if result.returncode == 0 else None
```

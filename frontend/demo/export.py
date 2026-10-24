"""Rebuild the standalone local prototype using only Python's standard library."""
from html import escape
from pathlib import Path

root = Path(__file__).resolve().parent
source = (root / 'source.html').read_text(encoding='utf-8')
template = (root / 'template.html').read_text(encoding='utf-8')
marker = '__SHIJI_FRAGMENT__'
if template.count(marker) != 1:
    raise SystemExit('The standalone template must contain exactly one fragment slot.')
output = template.replace(marker, escape(source, quote=True))
router = (root / 'browser-navigation.js').read_text(encoding='utf-8').replace('</script', '<\\/script')
before, after = output.rsplit('</body>', 1)
output = before + '<script>\n' + router + '\n</script>\n</body>' + after
(root / 'index.html').write_text(output, encoding='utf-8')
print('Updated frontend/demo/index.html')

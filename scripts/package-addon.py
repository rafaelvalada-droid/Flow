"""Build the Gmail add-on ZIP (Apps Script files + Supabase SQL) without third-party packages."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / 'downloads' / 'flow-gmail-addon.zip'
FILES = (('gmail-addon/Code.gs', 'Code.gs'), ('gmail-addon/appsscript.json', 'appsscript.json'),
         ('gmail-addon/README.md', 'README.md'), ('supabase/gmail-addon.sql', 'supabase/gmail-addon.sql'))

DESTINATION.parent.mkdir(exist_ok=True)
with ZipFile(DESTINATION, 'w', compression=ZIP_DEFLATED) as archive:
    for source, name in FILES:
        info = ZipInfo('flow-gmail-addon/' + name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (ROOT / source).read_bytes())
print(f'Add-on packaged: {DESTINATION.relative_to(ROOT)}')

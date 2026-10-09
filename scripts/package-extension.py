"""Build the installable unpacked-extension ZIP without third-party packages."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'extensao-chrome'
DESTINATION = ROOT / 'downloads' / 'flow-gmail-extension.zip'
FILES = ('manifest.json', 'shared.js', 'background.js', 'gmail.js',
         'flow-bridge.js', 'popup.html', 'popup.js', 'README.md', 'flow-mark.png')

DESTINATION.parent.mkdir(exist_ok=True)
with ZipFile(DESTINATION, 'w', compression=ZIP_DEFLATED) as archive:
    for name in FILES:
        info = ZipInfo('flow-gmail/' + name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (SOURCE / name).read_bytes())
print(f'Extension packaged: {DESTINATION.relative_to(ROOT)}')

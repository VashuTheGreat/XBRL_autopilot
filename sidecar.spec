# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the XBRL Autopilot sidecar (docs/10-packaging-release.md).

Builds an onedir distribution into sidecar-dist/xap-sidecar.
Ships inside the packaged Electron application under resources/sidecar.
"""
import os
import sys
from pathlib import Path

block_cipher = None

a = Analysis(
    ['api/__main__.py'],
    pathex=['.'],
    binaries=[],
    datas=[],
    hiddenimports=[
        'api.app',
        'api.v1.routes.fix',
        'api.v1.routes.mapping',
        'api.v1.routes.taxonomies',
        'api.v1.routes.workbooks',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespans',
        'uvicorn.lifespans.on',
        'uvicorn.lifespans.off',
        # Pinned xlrd (ADR-0013 / Phase 11b)
        'xlrd',
        'python_calamine',
        'openpyxl',
        'lxml',
        'fastapi',
        'pydantic',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'torch',
        'torchvision',
        'torchaudio',
        'transformers',
        'sentence_transformers',
        'scipy',
        'matplotlib',
        'tkinter',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='xap-sidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='xap-sidecar',
)

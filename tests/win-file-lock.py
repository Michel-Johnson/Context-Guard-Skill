"""Hold a real Windows file handle that disallows replacement (test fixture only)."""
import ctypes
import sys
import time
from ctypes import wintypes

api = ctypes.WinDLL("kernel32", use_last_error=True)
api.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
api.CreateFileW.restype = wintypes.HANDLE
handle = api.CreateFileW(sys.argv[1], 0x80000000, 3, None, 3, 0, None)
if handle == wintypes.HANDLE(-1).value:
    raise ctypes.WinError(ctypes.get_last_error())
try:
    print("locked", flush=True)
    time.sleep(float(sys.argv[2]))
finally:
    api.CloseHandle.argtypes = [wintypes.HANDLE]
    api.CloseHandle(handle)

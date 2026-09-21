@echo off
echo ========================================================
echo Installing ByteMind mkcert Local CA to Windows Trust Store
echo ========================================================
echo.
echo When the Windows "Security Warning" dialog appears,
echo please click [YES] to trust the development CA.
echo.
"%~dp0certs\mkcert.exe" -install
echo.
echo Done! Please restart your browser or reload https://localhost:5174
pause

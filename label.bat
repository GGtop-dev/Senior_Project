@echo off
cd /d "%~dp0"
if not exist labels_json mkdir labels_json
rem xanylabeling.exe is blocked by Windows, so run the module through the venv python
"..\X-AnyLabeling\.venv\Scripts\python.exe" -m anylabeling.app --filename "%~dp0src_images" --output "%~dp0labels_json" --labels "%~dp0classes.txt" --nodata --autosave --nosortlabels --validatelabel exact --no-auto-update-check
if errorlevel 1 pause

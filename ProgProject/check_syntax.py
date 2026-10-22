import py_compile, sys, traceback
try:
    py_compile.compile(r"d:\Prog Project\tg_farm_manager\orchestrator.py", doraise=True)
    print("OK - no syntax errors")
except Exception as e:
    print(type(e).__name__)
    traceback.print_exc()

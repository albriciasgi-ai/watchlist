"""
Unicode Character Checker
Scans all Python files for non-ASCII characters
"""
import os
import re

def check_files():
    files_to_check = ['main.py']

    # Add all trading module files
    trading_dir = 'trading'
    if os.path.exists(trading_dir):
        for filename in os.listdir(trading_dir):
            if filename.endswith('.py'):
                files_to_check.append(os.path.join(trading_dir, filename))

    found_unicode = False
    results = []

    for filepath in files_to_check:
        if not os.path.exists(filepath):
            continue

        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        for i, line in enumerate(lines, 1):
            # Check for non-ASCII characters
            non_ascii = re.findall(r'[^\x00-\x7F]', line)
            if non_ascii:
                found_unicode = True
                # Show first 100 chars of line
                preview = line.rstrip()[:100]
                results.append(f"{filepath}:{i}: {preview}")
                results.append(f"  Non-ASCII chars: {[hex(ord(c)) for c in set(non_ascii)]}")

    if not found_unicode:
        print("[OK] All Python files are ASCII-clean!")
        print(f"Checked {len(files_to_check)} files")
        return True
    else:
        # Write results to file to avoid console encoding issues
        with open('unicode_report.txt', 'w', encoding='utf-8') as f:
            f.write('\n'.join(results))
        print(f"[WARNING] Found Unicode characters - see unicode_report.txt")
        print(f"Found {len([r for r in results if ':' in r.split(':')[0]])} lines with Unicode")
        return False

if __name__ == "__main__":
    success = check_files()
    exit(0 if success else 1)

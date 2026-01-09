#!/usr/bin/env python3
"""
Remove ALL Unicode emojis and special characters from ALL Python files in backend
"""

import os
import glob

# Comprehensive emoji/symbol mapping
UNICODE_REPLACEMENTS = {
    # Emojis
    '🔄': '[UPDATE]',
    '📊': '[DATA]',
    '✅': '[OK]',
    '❌': '[ERROR]',
    '⚠️': '[WARN]',
    '⚠': '[WARN]',
    '🔍': '[DEBUG]',
    '📦': '[CACHE]',
    '🎯': '[TARGET]',
    '🚀': '[START]',
    '💾': '[SAVE]',
    '📈': '[CHART]',
    '🔔': '[ALERT]',
    '📅': '[DATE]',
    '🆕': '[NEW]',
    '🎨': '[RENDER]',
    '💡': '[INFO]',
    '📧': '[EMAIL]',
    '📬': '[MAILBOX]',
    '📩': '[ENVELOPE]',

    # Arrows and symbols
    '→': '->',
    '←': '<-',
    '↑': '^',
    '↓': 'v',
    '⇒': '=>',
    '⇐': '<=',
    '↔': '<->',
    '⏱️': '[TIMER]',
    '⏱': '[TIMER]',
    '⏰': '[ALARM]',
    '🕐': '[TIME]',
    '✨': '[STAR]',
    '💪': '[STRONG]',
    '🎉': '[CELEBRATE]',
    '🔥': '[FIRE]',
    '⭐': '[STAR]',
    '💻': '[COMPUTER]',
    '🌟': '[STAR]',
    '📝': '[NOTE]',
    '📌': '[PIN]',
    '🗑️': '[TRASH]',
    '🗑': '[TRASH]',
    '🔒': '[LOCK]',
    '🔓': '[UNLOCK]',
    '🆗': '[OK]',
    '🆙': '[UP]',
    '🔎': '[SEARCH]',
    '📡': '[SIGNAL]',
    '🌐': '[GLOBAL]',
    '💰': '[MONEY]',
    '📉': '[DOWN]',
    '🔨': '[HAMMER]',
    '🐉': '[DRAGON]',
    '🪦': '[TOMB]',
    '⏳': '[HOURGLASS]',
    '⌛': '[HOURGLASS]',

    # Variation selectors (invisible characters that cause issues)
    '\uFE0F': '',  # VARIATION SELECTOR-16
    '\uFE0E': '',  # VARIATION SELECTOR-15
}

def process_file(filepath):
    """Remove all Unicode characters from a single file"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        original_content = content
        replacements_made = {}

        # Apply known replacements
        for unicode_char, replacement in UNICODE_REPLACEMENTS.items():
            if unicode_char in content:
                count = content.count(unicode_char)
                content = content.replace(unicode_char, replacement)
                if count > 0:
                    replacements_made[unicode_char] = count

        # Only write if changes were made
        if content != original_content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            return True, len(replacements_made), replacements_made

        return False, 0, {}

    except Exception as e:
        return False, 0, {'error': str(e)}

def main():
    # Find all Python files in current directory
    python_files = glob.glob('*.py')

    total_files_changed = 0
    total_replacements = {}

    for pyfile in python_files:
        # Skip this script itself
        if pyfile in ['fix_all_unicode.py', 'remove_all_unicode.py']:
            continue

        changed, count, replacements = process_file(pyfile)
        if changed:
            total_files_changed += 1
            for char, char_count in replacements.items():
                if char not in total_replacements:
                    total_replacements[char] = 0
                total_replacements[char] += char_count

    # Write log
    with open('unicode_fix_all.log', 'w', encoding='utf-8') as log:
        log.write('Unicode Replacements Made Across All Files:\n')
        log.write('=' * 50 + '\n\n')

        for char, count in total_replacements.items():
            try:
                char_code = f"U+{ord(char):04X}"
            except:
                char_code = "UNKNOWN"
            try:
                replacement = UNICODE_REPLACEMENTS.get(char, '???')
                log.write(f"{char_code} -> {replacement}: {count} replacements\n")
            except:
                log.write(f"{char_code}: {count} replacements\n")

        log.write(f"\nTotal files modified: {total_files_changed}\n")
        log.write(f"\nSUCCESS: Fixed {len(total_replacements)} different Unicode characters\n")

if __name__ == '__main__':
    main()

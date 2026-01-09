#!/usr/bin/env python3
"""
Remove ALL Unicode emojis and special characters from main.py
Replace them with ASCII equivalents
"""

# Comprehensive emoji/symbol mapping
UNICODE_REPLACEMENTS = {
    # Emojis ya incluidos
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

    # Arrows and symbols that also fail
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
    '📊': '[CHART]',
    '🔨': '[HAMMER]',
    '🐉': '[DRAGON]',
    '🪦': '[TOMB]',
    '⏳': '[HOURGLASS]',
    '⌛': '[HOURGLASS]',

    # Variation selectors (invisible characters that cause issues)
    '\uFE0F': '',  # VARIATION SELECTOR-16
    '\uFE0E': '',  # VARIATION SELECTOR-15
}

def remove_all_unicode_from_file(filepath):
    """Remove all Unicode characters from file"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        original_length = len(content)
        replacements_made = {}

        # First, apply known replacements
        for unicode_char, replacement in UNICODE_REPLACEMENTS.items():
            if unicode_char in content:
                count = content.count(unicode_char)
                content = content.replace(unicode_char, replacement)
                if count > 0:
                    replacements_made[unicode_char] = count

        # Log results to file (not print, to avoid encoding errors)
        with open('unicode_replacements.log', 'w', encoding='utf-8') as log:
            log.write('Unicode Replacements Made:\n')
            log.write('=' * 50 + '\n')
            for char, count in replacements_made.items():
                try:
                    char_name = f"U+{ord(char):04X}"
                except:
                    char_name = "UNKNOWN"
                log.write(f"{char_name}: {count} replacements\n")
            log.write(f"\nTotal characters processed: {original_length}\n")
            log.write(f"New length: {len(content)}\n")

        # Write back
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

        return True, len(replacements_made)

    except Exception as e:
        with open('unicode_replacements.log', 'w', encoding='utf-8') as log:
            log.write(f'ERROR: {str(e)}\n')
        return False, 0

if __name__ == '__main__':
    success, count = remove_all_unicode_from_file('main.py')
    if success:
        with open('unicode_replacements.log', 'a', encoding='utf-8') as log:
            log.write(f'\nSUCCESS: Applied {count} different Unicode character replacements\n')
    else:
        with open('unicode_replacements.log', 'a', encoding='utf-8') as log:
            log.write('\nFAILED to process file\n')

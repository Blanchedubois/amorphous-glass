#!/usr/bin/env python3
"""Liquid Glass tokens (tokens/radius.json, tokens/glass.json; docs/STANDARD.md).

  glass-tokens.py get PATH [MODE]     one value: 'menu.radius', or 'hover' for MODE's colour
  glass-tokens.py render FILE MODE    FILE with every {{menu.radius}} / {{mode.hover}} filled in
  glass-tokens.py bms                 Blur My Shell radius keys: 'SECTION KEY VALUE' per line
"""
import json, os, re, sys

TOKENS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tokens')
RADIUS = json.load(open(os.path.join(TOKENS, 'radius.json')))
GLASS = json.load(open(os.path.join(TOKENS, 'glass.json')))


def radius(path):
    value = RADIUS
    for part in path.split('.'):
        value = value[part]
    return value


def lookup(path, mode):
    if path.startswith('mode.'):
        return GLASS[mode][path[5:]]
    return radius(path)


def main(argv):
    if len(argv) >= 2 and argv[0] == 'get':
        mode = argv[2] if len(argv) > 2 else 'dark'
        path = argv[1] if '.' in argv[1] else 'mode.' + argv[1]
        print(lookup(path, mode))
    elif len(argv) == 3 and argv[0] == 'render':
        text = open(argv[1]).read()
        sys.stdout.write(re.sub(r'\{\{([a-z_.]+)\}\}', lambda m: str(lookup(m.group(1), argv[2])), text))
    elif argv == ['bms']:
        for target, source in RADIUS['blur_my_shell'].items():
            section, key = target.split('/')
            print(section, key, radius(source))
    else:
        sys.exit(__doc__)


main(sys.argv[1:])

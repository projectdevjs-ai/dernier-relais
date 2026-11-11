# Convertit un glTF en JSON (données intégrées en base64) en fichier .glb : python3 scripts/gltf2glb.py entree.json sortie.glb
import json, base64, struct, sys
def b64(u): return base64.b64decode(u[u.index(',') + 1:])
def conv(src, dst):
    j = json.load(open(src)); parts = []; off = 0
    def push(a):
        nonlocal off
        pad = (4 - off % 4) % 4
        if pad: parts.append(b'\0' * pad); off += pad
        o = off; parts.append(a); off += len(a); return o
    push(b64(j['buffers'][0]['uri']))
    for im in j.get('images', []):
        u = im.get('uri', '')
        if u.startswith('data:'):
            a = b64(u); o = push(a); j['bufferViews'].append({'buffer': 0, 'byteOffset': o, 'byteLength': len(a)})
            im['bufferView'] = len(j['bufferViews']) - 1; im['mimeType'] = u[5:u.index(';')]; del im['uri']
    pad = (4 - off % 4) % 4
    if pad: parts.append(b'\0' * pad); off += pad
    j['buffers'] = [{'byteLength': off}]
    js = json.dumps(j, separators=(',', ':')).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
    open(dst, 'wb').write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + off) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', off, 0x004E4942) + b''.join(parts))
    return [a.get('name') for a in j.get('animations', [])]
if __name__ == '__main__': print(conv(sys.argv[1], sys.argv[2]))

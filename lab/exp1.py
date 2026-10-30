import yc, json
from PIL import Image, ImageEnhance, ImageFilter
ACT = ["wrinkle","pore","texture","radiance","acne","age_spot","redness","dark_circle_v2"]
src = Image.open('face1.jpg').convert('RGB')
src.save('v_base.jpg', quality=95)
def warm(im, r=1.08, b=0.92):
    R,G,B = im.split()
    return Image.merge('RGB',(R.point(lambda v:min(255,int(v*r))),G,B.point(lambda v:int(v*b))))
V = {
 'base': src,
 'bright25': ImageEnhance.Brightness(src).enhance(1.25),
 'blur2': src.filter(ImageFilter.GaussianBlur(2.0)),
 'warm': warm(src),
 'combo': ImageEnhance.Brightness(warm(src.filter(ImageFilter.GaussianBlur(2.0)))).enhance(1.2),
}
c0 = yc.credit(); out = {}
for k, im in V.items():
    f = f'v_{k}.jpg'; im.save(f, quality=95)
    r = yc.skin(f, actions=ACT)
    out[k] = {x['type']: (x['ui_score'], round(x['raw_score'],1)) for x in r['results']['output'] if 'ui_score' in x}
    print(k, out[k], flush=True)
print('cost', c0 - yc.credit())
json.dump(out, open('exp1.json','w'), indent=0)
print('\nchange vs base (ui_score):')
for k in V:
    print(k.ljust(9), {a: out[k][a][0]-out['base'][a][0] for a in ACT})

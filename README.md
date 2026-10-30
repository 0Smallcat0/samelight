# SameLight

Beauty ads compare two different photos. SameLight makes them compare two faces.

**Live app:** https://samelight.pages.dev

Most before and after ads are not lying about the product so much as about the photo. The after shot is softer, brighter and warmer, and together those three things raise skin scores with no change to the skin. SameLight checks an ad right before you pay: it brings both photos to the same focus, exposure and colour, measures the skin again with the YouCam Skin Analysis API, and shows how much of the promise is left.

## The finding behind it

The first experiment used one face and no skin change at all. A blur of two pixels raised the texture score from 61 to 92 and the pore score from 41 to 55. Adding warm light and 20% more brightness took pores to 69. The skin was identical. A skin AI is honest about what it sees, so the same API can tell you when the camera did the work.

## How it works

1. **Line up.** MediaPipe Face Landmarker runs in the browser, finds both faces, then levels and scales them to the same size. One screenshot holding both faces is split automatically.
2. **Match exposure and colour.** Eyes and brows do not brighten with skincare, so the ratio between them in the two photos gives the camera's gain for each colour channel.
3. **Match focus.** Eyes, brows and lip edges keep their detail whatever the skin does, so any loss of detail there is the camera. The sharper photo is softened with a Gaussian blur until two frequency bands match at those parts. Exposure has to come first, because a brightened photo has inflated contrast and reads as sharper than it is.
4. **Match lost highlights.** Detail blown out in the brighter photo cannot come back, so the same ceiling is applied to the other photo.
5. **Measure twice.** Skin Analysis scores the pair as published and again under the same light. A change counts only if it holds in both.

## Tested with known answers

Each test has a known answer. The faces are AI generated with the YouCam Text to Image API.

| Test | Pairs | Ad shows | Left under the same light |
| --- | --- | --- | --- |
| Camera tricks, no skin change | 3 | +88 pts | +2 pts (3%) |
| Real skin change, made with YouCam Skin Simulation | 3 | +161 pts | +145 pts (90%) |
| Real change plus camera tricks | 1 | +214 pts | +88 pts (41%) |
| Same photo, copied | 2 | +2 pts | +1 pt |

Points are the sum of score changes across pores, texture, wrinkles, dark spots, acne marks and radiance. Raw data is in [`lab/results.json`](lab/results.json), and [`lab/study.py`](lab/study.py) reproduces it through the same browser code the app uses.

## YouCam APIs used

- **Skin Analysis** (`/s2s/v2.1/task/skin-analysis`): the core measurement. Each check scores four photos, and the selfie check scores one more.
- **Skin Simulation** (`/s2s/v2.0/task/skin-simulation`): creates the real skin change used to test that SameLight keeps genuine results.
- **Text to Image** (`/s2s/v2.0/task/text-to-image/youcam`): creates the example and test faces, so no real customer appears in the app.

## Project layout

- `public/samelight.js`: the matching pipeline, which runs entirely in the browser.
- `public/app.js`, `index.html`, `style.css`: the page.
- `public/examples/`: checked examples that open without using API credit.
- `functions/api/`: Cloudflare Pages Functions that keep the API key on the server.
- `lab/`: experiments and the validation study.

## Run it

```
npm i -g wrangler
echo "YOUCAM_API_KEY=your_key" > .dev.vars
wrangler pages dev public
```

## Licence

MIT

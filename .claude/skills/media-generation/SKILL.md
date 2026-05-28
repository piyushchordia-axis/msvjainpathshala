---
name: media-generation
description: Generate and retrieve media including AI-generated images and stock images. Use this skill for visual content creation.
---

# Media Generation Skill

Generate custom images and retrieve stock images using external APIs via the Bash tool.

## When to Use

Use this skill when:

- Generating AI images for the project (icons, hero images, illustrations)
- Downloading stock photos
- Creating placeholder images

## When NOT to Use

- Copying images directly from websites (use stock APIs or generation instead)

## AI Image Generation

### Option 1: fal.ai (Flux, SDXL)

Requires `FAL_API_KEY` in `.env`. Get one at fal.ai.

```bash
# Install fal client
npm install @fal-ai/client
# or
pip install fal-client
```

```python
import fal_client
import base64, os

result = fal_client.run(
    "fal-ai/flux/schnell",
    arguments={
        "prompt": "A serene mountain landscape at sunset",
        "image_size": "landscape_16_9",
        "num_images": 1,
    }
)

# Download the image
import urllib.request
url = result["images"][0]["url"]
os.makedirs("attached_assets/generated_images", exist_ok=True)
urllib.request.urlretrieve(url, "attached_assets/generated_images/hero.png")
print("Saved to attached_assets/generated_images/hero.png")
```

### Option 2: OpenAI DALL-E 3

Requires `OPENAI_API_KEY` in `.env`.

```python
from openai import OpenAI
import urllib.request, os

client = OpenAI()
response = client.images.generate(
    model="dall-e-3",
    prompt="A serene mountain landscape at sunset, photorealistic",
    size="1792x1024",  # 16:9 ratio
    quality="standard",
    n=1,
)

url = response.data[0].url
os.makedirs("attached_assets/generated_images", exist_ok=True)
urllib.request.urlretrieve(url, "attached_assets/generated_images/hero.png")
print("Saved to attached_assets/generated_images/hero.png")
```

Or with curl:

```bash
mkdir -p attached_assets/generated_images

curl -s https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dall-e-3",
    "prompt": "A serene mountain landscape at sunset",
    "n": 1,
    "size": "1792x1024"
  }' | python3 -c "
import sys, json, urllib.request
data = json.load(sys.stdin)
url = data['data'][0]['url']
urllib.request.urlretrieve(url, 'attached_assets/generated_images/hero.png')
print('Saved')
"
```

### Option 3: Replicate

Requires `REPLICATE_API_TOKEN` in `.env`.

```bash
pip install replicate
```

```python
import replicate, urllib.request, os

output = replicate.run(
    "black-forest-labs/flux-schnell",
    input={"prompt": "A mountain landscape at sunset", "aspect_ratio": "16:9"}
)

os.makedirs("attached_assets/generated_images", exist_ok=True)
urllib.request.urlretrieve(str(output[0]), "attached_assets/generated_images/hero.png")
```

## Stock Images

### Unsplash (free, no key for basic use)

```bash
# Download a stock photo by search term
mkdir -p attached_assets/stock_images

# Search and download
curl -s "https://source.unsplash.com/1600x900/?mountain,landscape" \
  -L -o attached_assets/stock_images/mountain.jpg

# Different search terms
curl -s "https://source.unsplash.com/1200x800/?office,modern" \
  -L -o attached_assets/stock_images/office.jpg
```

### Unsplash API (with key — better quality control)

```bash
# Search for images
curl -s "https://api.unsplash.com/search/photos?query=mountain&per_page=3" \
  -H "Authorization: Client-ID $UNSPLASH_ACCESS_KEY" | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
for photo in data['results']:
    print(photo['urls']['regular'])
"
```

### Pexels (free API key)

```bash
curl -s "https://api.pexels.com/v1/search?query=mountain&per_page=1" \
  -H "Authorization: $PEXELS_API_KEY" | \
  python3 -c "
import sys, json, urllib.request, os
data = json.load(sys.stdin)
url = data['photos'][0]['src']['large2x']
os.makedirs('attached_assets/stock_images', exist_ok=True)
urllib.request.urlretrieve(url, 'attached_assets/stock_images/result.jpg')
print('Saved')
"
```

## Placeholder Images (no API key needed)

For development placeholders use a URL-based placeholder service in HTML/CSS:

```html
<!-- Placeholder image services (no download needed, use as src) -->
<img src="https://picsum.photos/1600/900" alt="placeholder">
<img src="https://picsum.photos/seed/mountain/800/600" alt="consistent placeholder">
```

Or download:

```bash
curl -L "https://picsum.photos/1600/900" -o attached_assets/placeholder.jpg
```

## Aspect Ratio Reference

| Ratio | Dimensions (approx) | Use case |
|-------|---------------------|----------|
| 1:1 | 1024x1024 | Square, icons |
| 4:3 | 1024x768 | Presentations |
| 16:9 | 1792x1024 | Hero, widescreen |
| 9:16 | 1024x1792 | Mobile portrait |
| 3:4 | 768x1024 | Portrait |

## Output Locations

By convention, save generated media to:
- AI images: `attached_assets/generated_images/`
- Stock images: `attached_assets/stock_images/`

```bash
mkdir -p attached_assets/generated_images attached_assets/stock_images
```

# Asteroid Hero

A mobile-friendly 2D browser game — **Asteroids meets Osmos**. Defend planets
from incoming asteroids using lasers, ship movement, and gravity itself.

## Gameplay

- Each sector features a different planetary body (the Moon, Earth, Mars,
  Neptune, Jupiter) with its own gravitational pull that bends every
  trajectory — asteroids' and yours.
- **Small asteroids** are destroyed by your lasers.
- **Large asteroids** are too massive to destroy quickly — laser fire *pushes*
  them, so deflect them off course before gravity drags them in.
- Asteroids collide with each other: gentle hits bounce, violent hits shatter
  rocks into fragments. Use collisions to your advantage.
- Anything that escapes the gravity well counts as a save. Protect the
  planet's shield; when it's gone, the planet is lost.

## Modes

- **Normal** — run out of lives and you retry the sector you're on, so you
  can keep advancing and explore later planets.
- **Hard** — run out of lives and it's back to Sector 1.

## Controls

| | Move | Aim | Fire |
|---|---|---|---|
| **Touch** | drag left half of screen | drag right half | hold right half |
| **Keyboard/mouse** | WASD / arrows | mouse | click or space |

`P` / `Esc` pauses.

## Tech

Zero-dependency vanilla JavaScript + HTML5 canvas. No build step.

## Run locally

Serve the directory with any static file server, e.g.:

```sh
npx serve .
```

## Deploy

Hosted on [Cloudflare Pages](https://pages.cloudflare.com/). Deploy with:

```sh
npx wrangler pages deploy . --project-name=asteroid-hero
```

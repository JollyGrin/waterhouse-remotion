# Event Promo Video Content Plan

## Overview
Automated Instagram Story videos promoting upcoming events. Each video should feel consistent (branded) but fresh (varied enough to not feel repetitive week-to-week).

## Data Sources Needed

### Event API
- Event name/title
- Date & time
- Venue/location
- Ticket link/price
- Event type/category (concert, DJ set, art show, etc.)

### Artist API
- Artist name
- Bio/tagline
- Genre/style tags
- Profile image (variable resolutions - need to handle gracefully)
- Social handles?

### Sound Bank
- Need a collection of audio clips (~10-15 seconds each)
- Organized by mood/energy: hype, chill, electronic, acoustic, etc.
- Could also pull artist preview clips if available?

---

## Content Structure Ideas

### Template A: "Countdown Reveal"
1. **Frames 0-90 (0-3s)**: Teaser text animation ("COMING SOON" / date flashing)
2. **Frames 90-210 (3-7s)**: Artist image reveal with name
3. **Frames 210-360 (7-12s)**: Event details (venue, time, vibe)
4. **Frames 360-450 (12-15s)**: CTA + ticket info + logo

### Template B: "Artist Spotlight"
1. **Frames 0-120 (0-4s)**: Full-bleed artist image with subtle motion
2. **Frames 120-270 (4-9s)**: Pull back, overlay artist name + genre tags
3. **Frames 270-390 (9-13s)**: Event info slides in
4. **Frames 390-450 (13-15s)**: "Link in bio" CTA

### Template C: "Quick Hype"
1. **Frames 0-60 (0-2s)**: Bold date stamp
2. **Frames 60-180 (2-6s)**: Rapid cuts - artist image, venue, vibes
3. **Frames 180-330 (6-11s)**: Artist name + event name big
4. **Frames 330-450 (11-15s)**: Details + CTA

---

## Variation Strategies (Keep it Fresh)

### Visual Variations
- **Color themes**: Pull accent colors from artist image? Or rotate through brand palette
- **Layout variations**: Image left vs right vs centered vs full-bleed
- **Text animations**: Slide up, fade in, typewriter, glitch, scale up
- **Backgrounds**: Solid color, gradient, blurred artist image, abstract patterns

### Dynamic Elements Based on Data
- **Event type styling**: Different visual treatment for DJ night vs live band vs art show
- **Urgency indicators**: "THIS WEEKEND" vs "NEXT MONTH" changes design urgency
- **Genre-specific aesthetics**: Electronic = glitchy/neon, Acoustic = warm/organic

### Randomization Ideas
- Randomly select from 3-4 text animation styles
- Randomly select entry/exit transitions
- Rotate through color accent options
- Different crop/zoom behaviors for artist images

---

## Audio Strategy

### Sound Bank Structure
```
/public/audio/
  /beds/           # Background music beds (10-15s loops)
    hype-01.mp3
    chill-01.mp3
    electronic-01.mp3
    ...
  /hits/           # Short sound effects (whoosh, impact, etc.)
    whoosh-01.mp3
    impact-01.mp3
    riser-01.mp3
    ...
```

### Audio Selection Logic
- Match audio bed to event type/genre
- Or: Random selection from curated "on-brand" pool
- Layer hits on transitions for punch

### Volume Considerations
- Instagram recommended: -14 LUFS
- Fade in/out at start/end
- Duck music under any voiceover (future feature?)

---

## Technical Considerations

### Handling Variable Image Resolutions
```tsx
// Options:
// 1. Use object-fit: cover (crop to fill)
// 2. Use object-fit: contain with styled background
// 3. Pre-process images to standard size via API
// 4. Detect dimensions and choose layout accordingly
```

### Image Component Pattern
```tsx
import { Img } from 'remotion';

<Img
  src={artistImageUrl}
  style={{
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center top' // Face usually at top
  }}
/>
```

### Props Schema (Zod)
```tsx
const EventPromoSchema = z.object({
  // Event data
  eventName: z.string(),
  eventDate: z.string(), // ISO date
  eventTime: z.string(),
  venue: z.string(),
  ticketUrl: z.string().optional(),
  eventType: z.enum(['concert', 'dj', 'art', 'comedy', 'other']),

  // Artist data
  artistName: z.string(),
  artistImage: z.string(), // URL
  artistGenre: z.string().optional(),

  // Variation controls
  template: z.enum(['countdown', 'spotlight', 'quickhype']),
  colorAccent: z.string().optional(),
  audioTrack: z.string().optional(),
});
```

---

## Open Questions

- [ ] What's the API endpoint structure? REST? GraphQL?
- [ ] How far in advance do we generate videos? (affects "X days away" logic)
- [ ] Do we need multi-event videos (weekly roundup)?
- [ ] Brand assets: logo, fonts, color palette?
- [ ] Any artist audio clips available for preview?
- [ ] Voiceover consideration for future?

---

## Next Steps

1. Define the props schema in code
2. Build out one template fully (suggest Template B: Artist Spotlight)
3. Set up audio import structure
4. Create image handling utilities
5. Add variation/randomization layer
6. Connect to actual API data

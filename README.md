# Buck Forecast

A one-page phone dashboard for deciding whether today is worth a sit at the FCH trail cams: a Go / Worth a sit / Skip call for today, morning and evening ratings for the next 7 days, people seen on camera (feed drops and anyone else), season totals, buck sightings by hour, bear sightings, and every camera's daily photo count with feed drops marked.

- `index.html` is the page, served by GitHub Pages. `rating.js` holds the rating rules.
- The data lives in Supabase (project "Buck Forecast") and is only readable after signing in with an approved account.
- Camera data is read from the Spypoint web app each morning by a scheduled task and saved to Supabase. Nothing is erased when Spypoint's filter stops showing older photos. Bucks seen in the photos that Spypoint didn't tag are saved as "possible" and not counted until the owner confirms them. The `weather` function in `supabase/functions` gets the National Weather Service forecast and works out sun times every 3 hours.
- `supabase/setup.sql` is a record of the database setup.

Nothing secret is stored here. The Supabase key in `index.html` is the public "publishable" key, designed to be visible; the data behind it is locked to approved users.

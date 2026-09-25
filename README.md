# Course Planner

A private-data teacher planning interface for the existing AP Biology and Anatomy & Physiology Google Sheets. Its website files are static and can be published through GitHub Pages; course data is fetched only after signing in with a Google account that can edit both original sheets.

## Start

1. Extract `index.html`, `style.css`, `app.js`, `calendar.js`, and `config.js` together into a new desktop folder. Open this folder as a repository in GitHub Desktop, publish it, and enable Pages from `main` / `(root)`.
2. The included `config.js` contains both original spreadsheet IDs and the public OAuth client ID used for your other tracker. If this site is at `https://zelensky-ea.github.io/COURSE-PLANNER/`, the existing authorized JavaScript origin `https://zelensky-ea.github.io` also covers it. For another account or custom domain, add that domain's *origin* in Google Cloud for this OAuth client first.
3. Optionally add URLs for your existing student Course Calendar and Navigator pages to `apBiologyPage` and `anatomyPage` in `config.js` to show links on the planning screen.
4. Visit your Pages site, click **Connect Google**, and use the school account with editor access to both source sheets.

Do not put a Google client secret or downloaded OAuth JSON in this repository. The public client ID in `config.js` is expected to be visible in a browser.

## What it changes

- The AP Biology **COURSE CALENDAR** and A&P **NAVIGATOR** tabs each contain 180 prebuilt school-day rows starting at row 4. Editing a lesson can save Date **C**, Topic **D**, Class **F**, Homework **I**, and Teacher Note **K** in that row.
- Marking **Lesson taught** uses unused column **L** in the same calendar, adding `Taught` to **L3** on its first status save. The app refuses to save taught status if it finds a different header in L3.
- The app reads teacher resources and topic targets from **STUDENT ASSIGNMENTS** and **A&P MASTER TOPICS**. It does not write to those tabs or overwrite the calendar's formula columns **E**, **G**, **H**, or **J**. AP Biology's helper list in **M** stays untouched.
- The pacing count includes dated class days through today that have a topic or class plan. AP Biology Thursday is a homework and note day without a class, so it is not counted. Anatomy Thursday repeats the Wednesday topic and class plan in the interface, with its own separate homework, note, and taught status. Editing the Wednesday plan changes what Thursday displays on the next refresh. The app leaves any existing Thursday topic or class plan cell untouched.
- `calendar.js` supplies read-only reminders from the district's [2026–27 academic calendar](https://resources.finalsite.net/images/v1780338576/salinasuhsdorg/kzr1ufhfq56vwhnn46jc/2026-2027SUHSDAcademicCalendar.pdf): holidays, no-class dates, the explicitly labeled December 18 and May 27 high school minimum days, and progress/grade deadlines. May 27, 2027 is the last student day. It excludes middle-school-only minimum days. Holiday days are excluded from pacing, even if an existing calendar row has a lesson. These reminders are displayed separately from teacher notes; they do not change the Google Sheets.
- Existing sheet dates only cover part of the year (AP Biology through October 2; Anatomy through September 25). Fill in subsequent dates as you plan to see the corresponding district reminder on each day card. The district dates panel shows upcoming events even when the sheet has no future dates. The page does not assign dates to future sheet rows automatically, because 36 Monday–Friday blocks do not cover every calendar week of the school year.
- When you save, the app rechecks the edited cells in the sheet and asks you to refresh if someone changed them meanwhile. Changes made by the original calendar, your existing student-facing pages, or the app appear after Refresh.

## If a calendar does not load

Check that the Google account has access to both originals, that the project has the Sheets API enabled, and that the OAuth client authorizes the GitHub Pages origin. The school's administrator may need to permit the Sheets scope. The app reports errors separately for each calendar so one unavailable sheet does not hide the other.

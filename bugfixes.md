# Bug Fixes & Feature Requests

## UI / Layout Fixes

* **Title Bar:**
  * Fix status update on the title bar (`updating status on title bar`).
* **Homepage:**
  * Fix the main homepage scroll container (`quella cazzo di scroll e che non ha mai funzionato sulla homepage`).
* **Menu Button:**
  * Standardize position across all screens.
  * Fix missing menu button in settings.
  * Correct menu button positioning in horizontal (landscape) mode.
* **Back Button Navigation:**
  * Ensure consistent back button position across views.
  * Fix functionality for both physical back button and UI button.
* **Colors & Borders:**
  * Show a default border when "no color" is selected.

---

## Calendar & Timetable Issues

* **Timetable View (Orario):**
  * **Lab Teacher Bug:** Fix test/exam placement showing in the wrong hour for lab teachers.
  * **Text Truncation:** Fix multi-line events (3+ lines) where the 3rd line gets partially cut off / visible.
* **Calendar Scroll & Navigation:**
  * Keep the current week pinned at the top.
  * Enable vertical month scrolling.
  * Fix issue where navigating too far into past/future events prevents returning to the current view.
  * Add a quick action button to **"Return to Today"**.
  * Fix missing display for far past and far future events.

---

## Popups & Event Details

* **Event Popups:**
  * Add the author's name to all event popups.
  * **Action Button Bug:** Investigate and fix missing "Mark as done" ("Segna come fatto") button when an event has `manual: true`.

---

## Grades & Subjects (Voti)

* **Period Selector:**
  * If only one period exists, display only "Tutto l'anno" and hide individual period options.
* **Subjects List:**
  * Make the subjects list scrollable in the grades view.

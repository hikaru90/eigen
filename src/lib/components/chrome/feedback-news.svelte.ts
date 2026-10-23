/**
 * The clay dot on the Make-me-better entry: the app has a note for you.
 * ei index.html ships the entry with `has-news`; app.js enterCircle() removes it once you've
 * looked. Here "looked" is remembered per browser, so the dot shows until the first visit to
 * /feedback (the page calls `clearFeedbackNote()` on mount).
 */
const SEEN_KEY = 'eigen-feedback-note-seen'

class FeedbackNewsStore {
  hasNote = $state(false)

  /** Called once from the entry's onMount: unread until the note has been seen. */
  init() {
    try {
      this.hasNote = localStorage.getItem(SEEN_KEY) !== '1'
    } catch {
      this.hasNote = true
    }
  }

  showNote() {
    this.hasNote = true
  }

  clearNote() {
    this.hasNote = false
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* storage unavailable: the dot simply returns next load */
    }
  }
}

export const feedbackNews = new FeedbackNewsStore()

export function showFeedbackNote() {
  feedbackNews.showNote()
}

export function clearFeedbackNote() {
  feedbackNews.clearNote()
}

/**
 * The clay dot on the Make-me-better entry: the app has a note for you.
 * DESIGN.md: a small clay dot on the loop means it has something to say;
 * the dot clears once you've looked. The /feedback surface (wave 3) calls
 * `showFeedbackNote()` when a note exists and `clearFeedbackNote()` when the
 * note has been seen. In-memory only — it refills the next time the app has
 * something to say.
 */
class FeedbackNewsStore {
  hasNote = $state(false)

  showNote() {
    this.hasNote = true
  }

  clearNote() {
    this.hasNote = false
  }
}

export const feedbackNews = new FeedbackNewsStore()

export function showFeedbackNote() {
  feedbackNews.showNote()
}

export function clearFeedbackNote() {
  feedbackNews.clearNote()
}

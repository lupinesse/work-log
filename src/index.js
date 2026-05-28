import './style/main.css'
import './js/app.js'

// Register the generated service worker for offline/PWA support. Registration
// is best-effort: failures are logged but never block the app from loading.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').then(
            registration => {
                console.log('ServiceWorker registered with scope:', registration.scope)
            },
            error => {
                console.log('ServiceWorker registration failed:', error)
            }
        )
    })
}

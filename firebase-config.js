// Firebase Configuration
// Replace these values with your Firebase project credentials
// Get them from Firebase Console: https://console.firebase.google.com/

const firebaseConfig = {
    apiKey: "AIzaSyCBc4N2ubtBMm784oP1XnPxxrt9LeTVWY8",
    authDomain: "sdkaraoke-2534a.firebaseapp.com",
    databaseURL: "https://sdkaraoke-2534a-default-rtdb.firebaseio.com",
    projectId: "sdkaraoke-2534a",
    storageBucket: "sdkaraoke-2534a.firebasestorage.app",
    messagingSenderId: "532495318004",
    appId: "1:532495318004:web:d86d12d0f97b35b82e57a1"
};

// Initialize Firebase only if firebase is defined and not already initialized
if (typeof firebase !== 'undefined') {
    try {
        // Check if already initialized
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        
        // Get reference to the database
        const database = firebase.database();
        
        // Firebase database references
        const usersRef = database.ref('users');
        const songsRef = database.ref('songs');
        const queueRef = database.ref('queue');
        const reservationsRef = database.ref('reservations');
    } catch (error) {
        console.warn('Firebase initialization skipped or failed:', error.message);
    }
} else {
    console.warn('Firebase SDK not loaded - using localStorage fallback');
}

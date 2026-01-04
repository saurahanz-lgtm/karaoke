// Firebase Configuration
// Replace these values with your Firebase project credentials
// Get them from Firebase Console: https://console.firebase.google.com/

const firebaseConfig = {
    apiKey: "AIzaSyD3c23oURDtPQdiBRjOoK44A6olwnQej8M",
    authDomain: "mykaraoke-586d9.firebaseapp.com",
    databaseURL: "https://mykaraoke-586d9-default-rtdb.firebaseio.com",
    projectId: "mykaraoke-586d9",
    storageBucket: "mykaraoke-586d9.firebasestorage.app",
    messagingSenderId: "157595077690",
    appId: "1:157595077690:web:3e563ac4662444c4387903",
    measurementId: "G-Z3EJTSHQXT"
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

// Firebase Configuration
// Replace these values with your Firebase project credentials
// Get them from Firebase Console: https://console.firebase.google.com/

const firebaseConfig = {
    apiKey: "AIzaSyCTZ_o87tAT4CTfqaHmwA-ou3v7XRGbkAQ",
    authDomain: "karaoke-890dd.firebaseapp.com",
    databaseURL: "https://karaoke-890dd-default-rtdb.firebaseio.com",
    projectId: "karaoke-890dd",
    storageBucket: "karaoke-890dd.firebasestorage.app",
    messagingSenderId: "45219903707",
    appId: "1:45219903707:web:9e5fbc1b096d0a143874fe"
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
        
        console.log('✅ Firebase initialized for project: karaoke-890dd');
        console.log('📝 NOTE: Configure Firebase Realtime Database Rules:');
        console.log('Go to Firebase Console > Realtime Database > Rules');
        console.log('Replace with: { "rules": { ".read": true, ".write": true } }');
        console.log('Then click "Publish" button');
    } catch (error) {
        console.warn('Firebase initialization skipped or failed:', error.message);
    }
} else {
    console.warn('Firebase SDK not loaded - using localStorage fallback');
}

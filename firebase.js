import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBpyqhWfRTu9sm0QtpoxQMMnBFOgJM7Y5I",
  authDomain: "jersey-9f56c.firebaseapp.com",
  projectId: "jersey-9f56c",
  storageBucket: "jersey-9f56c.firebasestorage.app",
  messagingSenderId: "79799931460",
  appId: "1:79799931460:web:041474be63e838cdcc6211"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

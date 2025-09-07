/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const elevenlabs_api_key = process.env.ELEVENLABS_API_KEY
const root = document.getElementById('root');

// --- STORAGE ---
// The app now uses IndexedDB for all persistent storage.

const DB_NAME = 'illustratEDDB';
const DB_VERSION = 2;
const STATE_STORE = 'stateStore';
const QUEST_DATA_STORE = 'questDataStore';

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject("Error opening IndexedDB.");
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STATE_STORE)) {
                db.createObjectStore(STATE_STORE);
            }
            if (!db.objectStoreNames.contains(QUEST_DATA_STORE)) {
                db.createObjectStore(QUEST_DATA_STORE, { keyPath: 'id' });
            }
        };
    });
}

async function dbGet(storeName, key): Promise<any> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbGetAll(storeName): Promise<any[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbPut(storeName, value, key?): Promise<any> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = key ? store.put(value, key) : store.put(value);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => {
            console.error('DB Put Error:', request.error);
            reject(request.error);
        }
    });
}

// --- APP STATE ---
const defaultState = {
    sparkles: 0,
    stickers: [],
    quests: [
        // Science
        { id: 'solar_system', title: 'Our Solar System', emoji: '🪐', prompt: 'Create a simple quest for a 5-year-old about the solar system.' },
        { id: 'dinosaurs', title: 'Mighty Dinosaurs', emoji: '🦖', prompt: 'Create a simple quest for a 6-year-old about dinosaurs.' },
        { id: 'oceans', title: 'Deep Blue Oceans', emoji: '🐳', prompt: 'Create a simple quest for a 5-year-old about ocean animals.' },
        { id: 'plant_life', title: 'How Plants Grow', emoji: '🌱', prompt: 'Create a quest for a 6-year-old about the life cycle of a plant.' },
        { id: 'human_body', title: 'The Human Body', emoji: '🧍', prompt: 'Create a simple quest for a 7-year-old about the human heart and lungs.' },
        { id: 'matter_states', title: 'Solid, Liquid, Gas', emoji: '🧊', prompt: 'Create a quest for an 8-year-old about the states of matter.' },
        { id: 'butterflies', title: 'Butterfly Changes', emoji: '🦋', prompt: 'Create a quest for a 5-year-old about the metamorphosis of a butterfly.' },
        // Math
        { id: 'fractions', title: 'Fun with Fractions', emoji: '🍕', prompt: 'Create a very simple quest for a 7-year-old introducing fractions with pizza examples.' },
        { id: 'addition', title: 'Adding Adventures', emoji: '➕', prompt: 'Create a quest for a 5-year-old on basic addition up to 10.' },
        { id: 'shapes', title: 'Shapes All Around', emoji: '🔷', prompt: 'Create a quest for a 5-year-old about identifying common shapes like circles, squares, and triangles.' },
        // Social Science
        { id: 'egypt', title: 'Ancient Egypt', emoji: '🏺', prompt: 'Create a quest for a 9-year-old about ancient Egyptian pyramids and pharaohs.' },
        { id: 'rainforest', title: 'Rainforest Animals', emoji: '🐒', prompt: 'Create a quest for a 7-year-old about animals in the Amazon rainforest.' },
        { id: 'landmarks', title: 'World Landmarks', emoji: '🗺️', prompt: 'Create a quest for an 8-year-old about famous world landmarks.' }
    ],
    questDataCache: {},
    currentScreen: 'quest_selection',
    currentQuest: null,
    currentStepIndex: 0,
    isLoading: false,
    loadingMessage: '',
};

let state = { ...defaultState };

const CORRECT_ANSWER_MESSAGES = [
    "Awesome!",
    "Brilliant!",
    "You got it!",
    "Superstar!",
    "Great job!",
    "Well done!",
    "Fantastic!",
];

const QUEST_COMPLETE_MESSAGES = [
    "Quest Complete! 🎉",
    "Amazing work! 🌟",
    "You're a superstar!",
    "Quest Master! 🏆",
    "You did it! 🥳",
];

// --- CORE LOGIC & API ---

async function saveCoreState() {
    const stateToSave = {
        sparkles: state.sparkles,
        stickers: state.stickers,
        // Only save custom quests to avoid duplicating defaults
        quests: state.quests.filter(q => q.id.startsWith('custom_')),
    };
    await dbPut(STATE_STORE, stateToSave, 'coreState');
}

async function saveQuestData(questId, data) {
    await dbPut(QUEST_DATA_STORE, { id: questId, ...data });
}

let isNarrating = false;
let narrationAudio = new Audio();

function stopNarration() {
    if (narrationAudio && !narrationAudio.paused) {
        narrationAudio.pause();
        narrationAudio.currentTime = 0; // Reset audio
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
    isNarrating = false; // Reset the flag
}

async function narrateText(text: string, buttonElement?: HTMLButtonElement) {
    if (isNarrating) {
        return; // Don't allow new narration if one is already in progress
    }
    // Stop any other audio that might be playing
    if (narrationAudio && !narrationAudio.paused) {
        narrationAudio.pause();
        narrationAudio.currentTime = 0;
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }

    if (!elevenlabs_api_key) {
        console.error("ElevenLabs API key not found. Narration will be disabled.");
        return;
    }
    
    isNarrating = true;
    if (buttonElement) {
        buttonElement.disabled = true;
    }

    const onFinish = () => {
        isNarrating = false;
        if (buttonElement) {
            buttonElement.disabled = false;
        }
    };

    try {
        const VOICE_ID = 'XrExE9yKIg1WjnnlVkGX';
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': elevenlabs_api_key,
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: { speed: 1.0, stability: 0.5, similarity_boost: 0.75 },
            }),
        });
        if (!response.ok) throw new Error(`ElevenLabs API request failed with status ${response.status}`);
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        narrationAudio = new Audio(audioUrl);
        
        narrationAudio.onended = onFinish;
        narrationAudio.onerror = () => {
            console.error("Error playing narration audio.");
            onFinish();
        };

        narrationAudio.play();
    } catch (error) {
        console.error("Failed to narrate text with ElevenLabs:", error);
        onFinish();
    }
}

function parseJsonFromResponse(text) {
    let jsonString = text.trim();
    const match = jsonString.match(/```json\n([\s\S]*?)\n```/);
    if (match && match[1]) {
        jsonString = match[1];
    } else {
        const jsonStartIndex = jsonString.indexOf('{');
        const jsonEndIndex = jsonString.lastIndexOf('}');
        if (jsonStartIndex !== -1 && jsonEndIndex !== -1 && jsonEndIndex > jsonStartIndex) {
            jsonString = jsonString.substring(jsonStartIndex, jsonEndIndex + 1);
        } else {
            throw new Error("Could not find a valid JSON object in the AI response.");
        }
    }
    return JSON.parse(jsonString);
}


async function getQuestData(quest) {
    if (state.questDataCache[quest.id]) {
        return state.questDataCache[quest.id];
    }
    
    const storedQuest = await dbGet(QUEST_DATA_STORE, quest.id);
    if (storedQuest) {
        state.questDataCache[quest.id] = storedQuest;
        return storedQuest;
    }

    setState({ isLoading: true, loadingMessage: 'Building your new quest...' });
    try {
        const prompt = `${quest.prompt}
        
The quest should have between 3 to 5 steps, alternating between lessons and flashcards.
Each flashcard should have 4 options and a correct answer.
Please respond with ONLY a valid JSON object inside a markdown code block (e.g., \`\`\`json ... \`\`\`).
The JSON object should have this structure: { "title": string, "steps": [ { "type": "lesson" | "flashcard", "content": string, "options"?: string[], "correctAnswer"?: string } ] }`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image-preview",
            contents: { parts: [{ text: prompt }] },
        });

        const questData = parseJsonFromResponse(response.text);

        if (!questData || !Array.isArray(questData.steps)) {
            console.error("Invalid response from AI:", response.text);
            throw new Error("Invalid quest data structure received from AI. 'steps' array is missing or not an array.");
        }

        // Generate images in parallel
        const lessonSteps = questData.steps.filter(step => step.type === 'lesson');
        const imagePromises = lessonSteps.map(step => generateIllustration(step.content));
        const imageUrls = await Promise.all(imagePromises);
        
        let imageIndex = 0;
        questData.steps.forEach(step => {
            if (step.type === 'lesson') {
                step.imageUrl = imageUrls[imageIndex++];
            }
        });

        state.questDataCache[quest.id] = questData;
        await saveQuestData(quest.id, questData);
        return questData;
    } catch (error) {
        console.error("Failed to generate quest data:", error);
        return { title: 'Error', steps: [{ type: 'lesson', content: 'Oops! We couldn\'t create this quest. Please try another one.', imageUrl: null }] };
    } finally {
        setState({ isLoading: false, loadingMessage: '' });
    }
}

async function generateIllustration(prompt) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: {
                parts: [{
                    text: `Generate a cute, simple, and colorful illustration for a children's book about: ${prompt}`
                }]
            },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });
        
        const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

        if (imagePart?.inlineData) {
            const base64ImageBytes = imagePart.inlineData.data;
            const mimeType = imagePart.inlineData.mimeType;
            return `data:${mimeType};base64,${base64ImageBytes}`;
        }
        
        console.warn("No image generated for prompt:", prompt);
        return null;
    } catch (error) {
        console.error("Failed to generate image:", error);
        return null;
    }
}

// --- STATE MANAGEMENT & EVENT HANDLERS ---

function setState(newState) {
    Object.assign(state, newState);
    render();
    saveCoreState();
}

function handleQuestSelection(quest) {
    stopNarration();
    setState({ currentQuest: quest, currentStepIndex: 0, currentScreen: 'quest_view' });
}

async function handleGenerateNewQuest(event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const input = form.querySelector('input');
    const userPrompt = input.value.trim();
    if (!userPrompt) return;

    setState({ isLoading: true, loadingMessage: 'Building your new quest...' });
    input.value = '';

    try {
        const prompt = `Generate a quest for a 7-year-old about "${userPrompt}".

The response must include a short, fun title, a single suitable emoji, and the quest content. 
The quest should have between 3 to 5 steps, alternating between lessons and flashcards.
Each flashcard must have exactly 4 options and a correct answer.

Please respond with ONLY a valid JSON object inside a markdown code block (e.g., \`\`\`json ... \`\`\`).
The JSON object should have this structure: { "title": string, "emoji": string, "steps": [ { "type": "lesson" | "flashcard", "content": string, "options"?: string[], "correctAnswer"?: string } ] }`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image-preview",
            contents: { parts: [{ text: prompt }] },
        });

        const questData = parseJsonFromResponse(response.text);

        if (!questData || !Array.isArray(questData.steps) || !questData.title || !questData.emoji) {
            console.error("Invalid response from AI for custom quest:", response.text);
            throw new Error("Invalid quest data structure received from AI. Required fields are missing.");
        }

        // Generate images in parallel
        const lessonSteps = questData.steps.filter(step => step.type === 'lesson');
        const imagePromises = lessonSteps.map(step => generateIllustration(step.content));
        const imageUrls = await Promise.all(imagePromises);
        
        let imageIndex = 0;
        questData.steps.forEach(step => {
            if (step.type === 'lesson') {
                step.imageUrl = imageUrls[imageIndex++];
            }
        });


        const newQuest = {
            id: `custom_${Date.now()}`,
            title: questData.title,
            emoji: questData.emoji,
            prompt: userPrompt
        };

        state.questDataCache[newQuest.id] = questData;
        await saveQuestData(newQuest.id, questData);

        setState({
            quests: [...state.quests, newQuest],
            currentQuest: newQuest,
            currentStepIndex: 0,
            currentScreen: 'quest_view',
            isLoading: false,
        });

    } catch (error) {
        console.error("Failed to generate custom quest:", error);
        alert("Oops! I couldn't create a quest for that topic. Please try another one!");
        setState({ isLoading: false });
    }
}

function triggerConfetti() {
    // Clean up any existing confetti container
    const existingContainer = document.querySelector('.confetti-container');
    if (existingContainer) {
        existingContainer.remove();
    }

    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    const colors = ['#f5a623', '#4a90e2', '#ffc107', '#4caf50', '#f44336', '#e91e63'];
    const confettiCount = 80;

    for (let i = 0; i < confettiCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'confetti-particle';
        
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        particle.style.animationDelay = `${Math.random() * 0.75}s`;
        
        // Add random shape and rotation
        if (Math.random() > 0.5) {
            particle.style.borderRadius = '50%';
        }
        particle.style.transform = `rotate(${Math.random() * 360}deg)`;
        
        container.appendChild(particle);
    }

    setTimeout(() => {
        container.remove();
    }, 4500); // Clean up after animation
}


function handleAnswer(option, correctAnswer, buttonElement) {
    const parent = buttonElement.parentElement;
    if (parent.dataset.answered) return;
    parent.dataset.answered = 'true';
    if (option === correctAnswer) {
        buttonElement.classList.add('correct');
        triggerConfetti();
        const sparklesEarned = 10;
        setState({ sparkles: state.sparkles + sparklesEarned });
        const randomMessage = CORRECT_ANSWER_MESSAGES[Math.floor(Math.random() * CORRECT_ANSWER_MESSAGES.length)];
        showRewardIndicator(`${randomMessage} +${sparklesEarned} ✨`);
    } else {
        buttonElement.classList.add('incorrect');
        const correctButton = Array.from(parent.children).find(btn => (btn as HTMLElement).textContent === correctAnswer);
        if (correctButton) (correctButton as HTMLElement).classList.add('correct');
    }
    setTimeout(handleNextStep, 2000);
}

function handleNextStep() {
    stopNarration();
    const currentQuestData = state.questDataCache[state.currentQuest.id];
    if (!currentQuestData) return;

    if (state.currentStepIndex < currentQuestData.steps.length - 1) {
        const newState: { currentStepIndex: number, sparkles?: number } = { 
            currentStepIndex: state.currentStepIndex + 1 
        };
        // Award sparkles for completing a lesson, not for starting the next step.
        const currentStep = currentQuestData.steps[state.currentStepIndex];
        if (currentStep.type === 'lesson') {
            const sparklesEarned = 25;
            newState.sparkles = state.sparkles + sparklesEarned;
            showRewardIndicator(`+${sparklesEarned} ✨`);
        }
        setState(newState);
    } else {
        const newSticker = { emoji: state.currentQuest.emoji, title: state.currentQuest.title };
        if (!state.stickers.some(s => s.title === newSticker.title)) {
            setState({ stickers: [...state.stickers, newSticker] });
        }
        const randomMessage = QUEST_COMPLETE_MESSAGES[Math.floor(Math.random() * QUEST_COMPLETE_MESSAGES.length)];
        showRewardIndicator(`${randomMessage} Sticker Unlocked!`, true);
        setTimeout(() => setState({ currentScreen: 'quest_selection' }), 3000);
    }
}


// --- RENDERING ---

async function render() {
    if (!root) return;
    const currentRenderCycle = Symbol();
    root.dataset.renderCycle = currentRenderCycle.toString();

    let screenContent;
    const main = document.createElement('main');

    if (state.isLoading) {
        screenContent = renderLoading();
        main.appendChild(screenContent);
    } else {
        switch (state.currentScreen) {
            case 'quest_selection':
                screenContent = renderQuestSelectionScreen();
                main.appendChild(screenContent);
                break;
            case 'quest_view':
                // Await the async content first
                screenContent = await renderQuestView(currentRenderCycle);
                // The check inside renderQuestView already handles staleness for the content itself.
                main.appendChild(screenContent);
                break;
            case 'sticker_book':
                screenContent = renderStickerBook();
                main.appendChild(screenContent);
                break;
        }
    }

    // After all async operations are complete, check if this render cycle is still the latest one.
    // If it's not, abort completely and don't touch the DOM.
    if (root.dataset.renderCycle !== currentRenderCycle.toString()) {
        return;
    }

    // If we are still the latest render, NOW we update the DOM.
    root.innerHTML = '';
    const header = renderHeader();
    root.appendChild(header);
    root.appendChild(main);
}

function renderHeader() {
    const header = document.createElement('header');
    const titleButton = document.createElement('button');
    titleButton.className = 'title-button';
    titleButton.innerHTML = `<h1>Illustrat<span>ED</span></h1>`;
    titleButton.onclick = () => {
        stopNarration();
        setState({ currentScreen: 'quest_selection' });
    };
    const nav = document.createElement('nav');
    const sparkleDisplay = document.createElement('div');
    sparkleDisplay.className = 'sparkle-display';
    sparkleDisplay.innerHTML = `<span>${state.sparkles}</span> ✨`;
    const stickerBookButton = document.createElement('button');
    stickerBookButton.className = 'sticker-book-button';
    stickerBookButton.innerHTML = 'Sticker Book 📖';
    stickerBookButton.onclick = () => {
        stopNarration();
        setState({ currentScreen: 'sticker_book' });
    };
    nav.append(sparkleDisplay, stickerBookButton);
    header.append(titleButton, nav);
    return header;
}

function renderLoading() {
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'loading-container';
    loadingContainer.innerHTML = `
        <div class="spinner"></div>
        <p>${state.loadingMessage}</p>
    `;
    return loadingContainer;
}

function renderQuestSelectionScreen() {
    const container = document.createElement('div');
    container.className = 'quest-selection-container';
    const welcome = document.createElement('div');
    welcome.className = 'welcome-message';
    welcome.innerHTML = `
        <h2>Welcome to IllustratED</h2>
        <p>This app is designed for kids of age 5 - 10</p>
    `;
    const generatorForm = document.createElement('form');
    generatorForm.className = 'quest-generator';
    generatorForm.innerHTML = `
        <input type="text" placeholder="Generate Quests for any topics in Math, Science and Social Studies" required />
        <button type="submit">✨ Generate</button>
    `;
    generatorForm.onsubmit = handleGenerateNewQuest;
    const discover = document.createElement('div');
    discover.className = 'discover-section';
    const discoverTitle = document.createElement('h3');
    discoverTitle.textContent = 'Discover';
    const discoverTabs = document.createElement('div');
    discoverTabs.className = 'discover-tabs';
    state.quests.forEach(quest => {
        const tab = document.createElement('button');
        tab.className = 'quest-tab';
        tab.innerHTML = `<span class="quest-emoji">${quest.emoji}</span><span class="quest-title">${quest.title}</span>`;
        tab.onclick = () => handleQuestSelection(quest);
        discoverTabs.appendChild(tab);
    });
    discover.append(discoverTitle, discoverTabs);
    container.append(welcome, generatorForm, discover);
    return container;
}

function renderStickerBook() {
    const container = document.createElement('div');
    container.className = 'sticker-book-container';
    container.innerHTML = '<h2>My Sticker Book</h2>';
    if (state.stickers.length === 0) {
        container.innerHTML += '<p>Complete quests to earn stickers!</p>';
    } else {
        container.innerHTML += '<p class="sticker-book-subtitle">Click a sticker to replay a quest!</p>';
        const stickerGrid = document.createElement('div');
        stickerGrid.className = 'sticker-grid';
        state.stickers.forEach(sticker => {
            const stickerEl = document.createElement('div');
            stickerEl.className = 'sticker';
            stickerEl.innerHTML = `<div class="sticker-emoji">${sticker.emoji}</div><div class="sticker-title">${sticker.title}</div>`;
            stickerEl.onclick = () => {
                const correspondingQuest = state.quests.find(q => q.title === sticker.title);
                if (correspondingQuest) {
                    handleQuestSelection(correspondingQuest);
                }
            };
            stickerGrid.appendChild(stickerEl);
        });
        container.appendChild(stickerGrid);
    }
    return container;
}

async function renderQuestView(renderCycle) {
    const container = document.createElement('div');
    container.className = 'quest-view-container';
    const questData = await getQuestData(state.currentQuest);

    // Check if the render cycle is still the current one after the async operation
    if (root.dataset.renderCycle !== renderCycle.toString()) {
        return document.createDocumentFragment();
    }

    if (!questData || !questData.steps) {
        container.innerHTML = '<p>Oops! Something went wrong loading the quest.</p>';
        const backButton = document.createElement('button');
        backButton.textContent = 'Back to Quests';
        backButton.onclick = () => setState({ currentScreen: 'quest_selection' });
        container.appendChild(backButton);
        return container;
    }

    // Progress Bar
    const progress = document.createElement('div');
    progress.className = 'progress-container';
    const progressText = document.createElement('span');
    progressText.textContent = `Step ${state.currentStepIndex + 1} of ${questData.steps.length}`;
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressBar.style.width = `${((state.currentStepIndex + 1) / questData.steps.length) * 100}%`;
    progress.append(progressText, progressBar);

    // Step Content
    const step = questData.steps[state.currentStepIndex];
    let stepContent;

    if (step.type === 'lesson') {
        stepContent = document.createElement('div');
        stepContent.className = 'lesson-container';

        const illustrationContainer = document.createElement('div');
        illustrationContainer.className = 'illustration-container';
        if (step.imageUrl) {
            const img = document.createElement('img');
            img.src = step.imageUrl;
            img.alt = step.content;
            illustrationContainer.appendChild(img);
        } else {
            illustrationContainer.innerHTML = '<div class="image-placeholder">🎨</div>';
        }

        const text = document.createElement('p');
        text.textContent = step.content;
        
        const controls = document.createElement('div');
        controls.className = 'lesson-controls';
        
        const listenButton = document.createElement('button');
        listenButton.innerHTML = 'Listen 🔊';
        listenButton.onclick = (e) => narrateText(step.content, e.target as HTMLButtonElement);
        
        const nextButton = document.createElement('button');
        nextButton.className = 'next-button';
        nextButton.textContent = 'Next →';
        nextButton.onclick = handleNextStep;

        controls.append(listenButton, nextButton);
        stepContent.append(illustrationContainer, text, controls);

    } else if (step.type === 'flashcard') {
        stepContent = document.createElement('div');
        stepContent.className = 'flashcard-container';
        
        const question = document.createElement('h3');
        question.textContent = step.content;

        const listenButton = document.createElement('button');
        listenButton.className = 'listen-icon-button';
        listenButton.innerHTML = '🔊';
        listenButton.onclick = (e) => narrateText(step.content, e.target as HTMLButtonElement);
        question.appendChild(listenButton);
        
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'options-container';
        
        step.options.forEach(option => {
            const button = document.createElement('button');
            button.textContent = option;
            button.onclick = () => handleAnswer(option, step.correctAnswer, button);
            optionsContainer.appendChild(button);
        });

        stepContent.append(question, optionsContainer);
    }

    container.append(progress, stepContent);
    return container;
}

function showRewardIndicator(message, isMajor = false) {
    const indicator = document.createElement('div');
    indicator.className = 'reward-indicator';
    if (isMajor) {
        indicator.classList.add('major');
    }
    indicator.textContent = message;
    document.body.appendChild(indicator);

    setTimeout(() => {
        indicator.remove();
    }, isMajor ? 3000 : 2000);
}

async function init() {
    try {
        setState({ isLoading: true, loadingMessage: 'Loading your adventure...' });

        // Load core state (sparkles, stickers, custom quests)
        const coreState = await dbGet(STATE_STORE, 'coreState');
        if (coreState) {
            // Merge default quests with saved custom quests
            const customQuests = coreState.quests || [];
            const combinedQuests = [
                ...defaultState.quests,
                ...customQuests.filter(cq => !defaultState.quests.some(dq => dq.id === cq.id))
            ];

            state.sparkles = coreState.sparkles || 0;
            state.stickers = coreState.stickers || [];
            state.quests = combinedQuests;
        }

        // Load all quest data from IndexedDB into the cache
        const allQuestData = await dbGetAll(QUEST_DATA_STORE);
        allQuestData.forEach(quest => {
            state.questDataCache[quest.id] = quest;
        });

    } catch (error) {
        console.error("Initialization failed:", error);
        // If init fails, we can proceed with the default state.
    } finally {
        setState({ isLoading: false, loadingMessage: '' });
    }
}

// Start the app
init();

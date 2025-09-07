# IllustratED

An educational application for children focused on History, Science, and Math. The app uses AI-generated illustrations to make learning engaging and visual. The core experience is driven by gamification, rewarding progress with collectible items and an in-app currency.

## Target Audience

Children aged 5-10.

## Key Features

### Quests ("Geminified" Lessons for learning Math, Science, and Social Studies)

- **Description:** A "Quest" is a themed, multi-step learning journey. Each Quest is a self-contained unit of learning, guiding the user through a specific topic (e.g., "The Life of a Star," "Ancient Rome," "Introduction to Fractions").
- **Structure:** Quests are composed of a series of illustrated lessons and interactive flashcard challenges.
- Images: 

### AI Voice Narration (using Elevenlabs)

- **Description:** A friendly AI voice will narrate all text descriptions and concept explanations within the app.
- **Functionality:** When a user opens a lesson, the voice will automatically begin narrating the content. On flashcards, the user can tap a "Listen" button to hear the question or answer read aloud.
- **Purpose:** Enhances accessibility for pre-readers and auditory learners. The voice will have a consistent, encouraging tone to foster a positive learning environment.

### Gamification 

#### Sparkles - In-App Currency (Gamification)

-  "Sparkles" are the primary in-app currency, earned by completing small tasks and answering questions correctly.

##### Stickers (Collectible Rewards)

- Stickers are non-consumable, one-time rewards given for completing major milestones.




## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` and `ELEVENLABS_API_KEY` in [.env.local](.env.local) for your Gemini API key and Elevenlabs key.

3. Run the app:
   `npm run dev`


## Demo

https://illustrated-1051240878135.us-west1.run.app
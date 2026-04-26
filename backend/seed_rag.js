require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

// Ensure you have SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OPENAI_API_KEY in your .env file
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service_role to bypass RLS

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const documentsToInsert = [
  // General Info & Psychoeducation
  {
    content: "PTSD (Post-Traumatic Stress Disorder) is a mental health condition triggered by experiencing or witnessing a terrifying event. Symptoms may include flashbacks, nightmares, severe anxiety, and uncontrollable thoughts about the event.",
    metadata: { source: "MoH / Clalit Guidelines", persona: "professional", category: "psychoeducation" }
  },
  {
    content: "פוסט טראומה (PTSD) היא הפרעה פסיכיאטרית שיכולה להתפתח לאחר חשיפה לאירוע טראומטי, כגון מלחמה, פיגוע, תאונה או תקיפה. התסמינים כוללים חודרנות (פלאשבקים), הימנעות מגירויים מזכירים, שינויים במצב הרוח, ועוררות יתר.",
    metadata: { source: "Clalit Health Services", persona: "professional", category: "psychoeducation", language: "hebrew" }
  },
  {
    content: "It's completely normal to experience intense emotions after a traumatic event. These reactions are your brain's way of trying to process what happened. Healing takes time, and you don't have to go through it alone.",
    metadata: { source: "General Support Script", persona: "friendly", category: "support" }
  },
  
  // Grounding & Coping Techniques
  {
    content: "When experiencing an anxiety or panic attack, a common grounding technique is the 5-4-3-2-1 method. Find 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, and 1 you can taste.",
    metadata: { source: "PTSD Coach / Coping Methods", persona: "professional", category: "grounding" }
  },
  {
    content: "I hear you, and it's totally okay to feel what you're feeling right now. Let's try grounding ourselves. Can you look around and name 5 things you can see? You're safe here.",
    metadata: { source: "Friendly Coping Script", persona: "friendly", category: "grounding" }
  },
  {
    content: "טכניקת קרקוע (Grounding) יכולה לעזור בזמן ניתוק או התקף חרדה. נסה להתרכז בנשימות עמוקות: שאף דרך האף ספור עד 4, החזק את האוויר לספירה של 2, ונשוף לאט דרך הפה לספירה של 6.",
    metadata: { source: "TipulPsychology", persona: "friendly", category: "grounding", language: "hebrew" }
  },
  
  // Prolonged Exposure (PE) Protocol (from Thousand Voices / Best Practices)
  {
    content: "Prolonged Exposure (PE) therapy helps you confront trauma-related memories and situations in a safe manner. It involves two main components: Imaginal Exposure (recounting the trauma memory) and In Vivo Exposure (gradually facing safe but avoided situations).",
    metadata: { source: "PE Protocol / Academic Benchmark", persona: "professional", category: "therapy_info" }
  },
  {
    content: "טיפול בחשיפה ממושכת (PE) נחשב לאחד הטיפולים היעילים ביותר לפוסט טראומה. הטיפול כולל חשיפה הדרגתית לזיכרונות הטראומטיים (חשיפה בדמיון) ולמצבים מציאותיים שמהם המטופל נמנע (חשיפה במציאות), כדי להפחית את החרדה הקשורה אליהם.",
    metadata: { source: "TipulPsychology", persona: "professional", category: "therapy_info", language: "hebrew" }
  },
  {
    content: "Phase 1 of PE therapy usually involves psychoeducation and breathing retraining. The therapist explains the rationale behind the treatment and teaches the patient techniques to manage immediate anxiety.",
    metadata: { source: "PE Protocol", persona: "professional", category: "therapy_phases" }
  },

  // Practical Rights and Resources (KolZchut)
  {
    content: "Individuals diagnosed with PTSD due to a workplace accident, hostile action (terror attack), or military service in Israel are entitled to various benefits through the National Insurance Institute (Bituah Leumi) or the Ministry of Defense. This can include financial stipends, therapy funding, and rehabilitation programs.",
    metadata: { source: "KolZchut Rights", persona: "professional", category: "resources" }
  },
  {
    content: "לנפגעי פוסט טראומה בישראל (בעקבות פעולת איבה, שירות צבאי, או תאונת עבודה) יש זכויות דרך המוסד לביטוח לאומי ומשרד הביטחון. חשוב להגיש תביעה להכרה בנכות כדי לקבל סיוע בטיפולים נפשיים, קצבאות, ושיקום תעסוקתי.",
    metadata: { source: "KolZchut Rights", persona: "professional", category: "resources", language: "hebrew" }
  },
  {
    content: "If you feel in immediate danger or a severe crisis, please reach out to emergency mental health hotlines. In Israel, ERAN (1201) offers emotional first aid, and NATAL (1-800-363-363) provides support for trauma related to war and terror.",
    metadata: { source: "Emergency Resources", persona: "friendly", category: "emergency" }
  },
  {
    content: "אם אתה או מישהו שאתה מכיר נמצא במשבר חריף, אל תהסס לפנות לעזרה. עמותת ער\"ן מספקת עזרה ראשונה נפשית בטלפון 1201, ונט\"ל (1-800-363-363) מעניקים תמיכה לנפגעי טראומה על רקע לאומי.",
    metadata: { source: "Emergency Resources", persona: "friendly", category: "emergency", language: "hebrew" }
  },
  
  // Specific trauma recovery advice
  {
    content: "Avoidance is a common symptom of PTSD, but it often makes the fear stronger over time. Taking small, manageable steps to face the things you've been avoiding can build confidence and reduce anxiety.",
    metadata: { source: "Clinical Best Practice", persona: "professional", category: "therapy_advice" }
  },
  {
    content: "הימנעות ממקומות, אנשים או מחשבות שמזכירים את הטראומה עלולה להחמיר את הסימפטומים בטווח הארוך. הטיפול מעודד חזרה הדרגתית לשגרת החיים תוך התמודדות מבוקרת עם הגורמים המעוררים חרדה.",
    metadata: { source: "MoH / TipulPsychology", persona: "professional", category: "therapy_advice", language: "hebrew" }
  }
];

async function seedKnowledgeBase() {
  console.log("Starting to seed RAG database...");

  for (const doc of documentsToInsert) {
    console.log(`Generating embedding for: "${doc.content.substring(0, 30)}..."`);
    
    try {
      const embeddingResponse = await openai.embeddings.create({
        model: 'nvidia/llama-nemotron-embed-vl-1b-v2:free', // Generates a 2048-dimensional vector
        input: doc.content,
        encoding_format: 'float',
      });

      if (!embeddingResponse.data) {
        console.error("OpenRouter Response missing data:", JSON.stringify(embeddingResponse, null, 2));
        continue;
      }

      const embedding = embeddingResponse.data[0].embedding;

      // Insert into Supabase knowledge_base table
      const { error } = await supabase
        .from('knowledge_base')
        .insert({
          content: doc.content,
          metadata: doc.metadata,
          embedding: embedding
        });

      if (error) {
        console.error("Error inserting document:", error.message);
      } else {
        console.log("Successfully inserted document!");
      }
    } catch (err) {
      console.error("Failed to generate embedding or insert:", err.message);
    }
  }
  
  console.log("Seeding complete. You can now test retrieval.");
}

// Optional: A helper function to test the RAG retrieval!
async function testRetrieval(query) {
  console.log(`\n--- Testing Retrieval for query: "${query}" ---`);
  
  const embeddingResponse = await openai.embeddings.create({
    model: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
    input: query,
    encoding_format: 'float',
  });

  const queryEmbedding = embeddingResponse.data[0].embedding;

  // Call the Postgres function we added to schema.sql
  const { data, error } = await supabase.rpc('match_knowledge_base', {
    query_embedding: queryEmbedding,
    match_threshold: 0.5, // 0 to 1, higher means more strict similarity
    match_count: 2        // Number of results to return
  });

  if (error) {
    console.error("Error querying knowledge base:", error.message);
    return;
  }

  console.log("Found matches:");
  data.forEach((match, index) => {
    console.log(`\nMatch ${index + 1} (Score: ${(match.similarity * 100).toFixed(2)}%):`);
    console.log(`Content: ${match.content}`);
    console.log(`Metadata:`, match.metadata);
  });
}

// Run the script
async function main() {
  // 1. Seed the data
  await seedKnowledgeBase();
  
  // 2. Wait a moment and test the retrieval
  await testRetrieval("I am feeling really overwhelmed and need to ground myself. Do you have a friendly tip?");
}

main();

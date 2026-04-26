const { Router } = require('express');
const multer = require('multer');
const { OpenAI } = require('openai');
const fs = require('fs');

const router = Router();
const upload = multer({ dest: 'uploads/' }); // Temp directory for multer

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * POST /api/audio/stt
 * Accepts multipart/form-data with 'audio' field containing the recording.
 * Uses OpenAI Whisper to transcribe to text.
 */
router.post('/stt', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const audioFile = fs.createReadStream(req.file.path);
    
    const response = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
    });

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    res.json({ text: response.text });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
});

/**
 * POST /api/audio/tts
 * Accepts JSON { text: "..." }
 * Uses OpenAI TTS-1 to generate audio, pipes it back as audio/mpeg.
 */
router.post('/tts', async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'echo', // Echo is calm and grounding
      input: text,
    });

    const buffer = Buffer.from(await response.arrayBuffer());

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
    });
    
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

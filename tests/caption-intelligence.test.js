import assert from "node:assert/strict";
import test from "node:test";
import {
  BANNED_CAPTION_PHRASES,
  buildCaptionAnalysis,
  buildCaptionModelPrompt,
  buildCaptionHumanizerPrompt,
  captionHumanVoiceDiagnostics,
  captionTranscriptEchoDiagnostics,
  captionFingerprint,
  extractResponsesOutputText,
  generateCaptionIntelligence,
  validateCaptionCandidate
} from "../CLIPPING OFFICE /services/caption-intelligence.js";

test("caption model receives the exact auto message with the full transcript", () => {
  const transcript = "They waited all that time and can only use it for twenty minutes.";
  const automaticCaptionRequest = `Use the attached frames.\n\nFULL TRANSCRIPT:\n${transcript}`;
  const input = {
    streamerName: "Clix",
    category: "IRL",
    transcript,
    automaticCaptionRequest
  };
  const prompt = buildCaptionModelPrompt(input, buildCaptionAnalysis(input));
  assert.match(prompt, /ARGENTUM AUTO MESSAGE:/);
  assert.ok(prompt.includes(automaticCaptionRequest));
  assert.ok(prompt.includes(transcript));
});

const fixtures = [
  { type: "business", name: "Nmplol", category: "Just Chatting", transcript: "We're building a massive neighborhood for like a million families in Texas. Wouldn't you be able to build a house for like 100K?", token: "million" },
  { type: "funny", name: "Maya", category: "IRL", transcript: "I put salt in the coffee instead of sugar and nobody told me until I drank it.", token: "salt" },
  { type: "gaming win", name: "TenZ", category: "Valorant", transcript: "No way, he won the 1v4 with one health left. That was the clutch.", token: "1v4" },
  { type: "gaming loss", name: "Jynxzi", category: "Rainbow Six", transcript: "I missed the last shot and lost the entire ranked game.", token: "lost" },
  { type: "rage", name: "Tyler1", category: "League of Legends", transcript: "Why did my teammate throw that fight? We had already won the game.", token: "throw" },
  { type: "money", name: "Kai", category: "Just Chatting", transcript: "The dealer wants 25K for the car before I can even test drive it.", token: "25K" },
  { type: "relationship", name: "Fanum", category: "Just Chatting", transcript: "I called my ex and she answered while my new date was sitting right here.", token: "ex" },
  { type: "confession", name: "Duke", category: "Just Chatting", transcript: "I never told anybody this, but I lied about owning that watch.", token: "watch" },
  { type: "educational", name: "Marques", category: "Science & Technology", transcript: "Your phone battery ages faster when it stays hot while charging.", token: "battery" },
  { type: "wholesome", name: "Speed", category: "IRL", transcript: "Meeting Ronaldo was my dream and I cannot believe he remembered me.", token: "Ronaldo" },
  { type: "argument", name: "Hasan", category: "Just Chatting", transcript: "We disagree because the rent increase was never included in the original deal.", token: "rent" },
  { type: "sarcasm", name: "Ludwig", category: "Just Chatting", transcript: "Yeah, perfect idea, let us delete the save file after ten hours of work.", token: "save" },
  { type: "multiple speakers", name: "QT", category: "Podcast", transcript: "Speaker one says the ticket was 500 dollars. Speaker two says it actually cost 350.", token: "500" },
  { type: "technical", name: "AsianJeff", category: "Gaming", transcript: "Is your game frozen? What happened? Do you want me to take control?", token: "frozen" },
  { type: "shaving", name: "AsianJeff", category: "IRL", transcript: "We are going to use shaving cream. I have never shaved like this before.", token: "shaving" },
  { type: "sports plea", name: "Jynxzi", category: "Sports", transcript: "Messi, please win this game. You gotta win this game for us.", token: "Messi" },
  { type: "sports defense", name: "Jynxzi", category: "Sports", transcript: "Messi has no control over who he plays. All he controls is whether he wins, and he has not lost.", token: "Messi" },
  { type: "product", name: "Linus", category: "Science & Technology", transcript: "This keyboard costs 300 dollars but the switches feel worse than the 40 dollar one.", token: "300" },
  { type: "challenge", name: "MrBeast", category: "IRL", transcript: "If he stays in the room for 24 hours, he wins 10,000 dollars.", token: "24" },
  { type: "prediction", name: "Tarik", category: "Valorant", transcript: "I think they could reverse sweep after losing the first two maps.", token: "reverse" },
  { type: "food", name: "Nick", category: "Food", transcript: "This chicken has been outside for three hours. We need to wash everything before cooking.", token: "chicken" },
  { type: "music", name: "Plaqueboymax", category: "Music", transcript: "He made the entire beat in ten minutes and the hook is already stuck in my head.", token: "beat" },
  { type: "awkward", name: "ExtraEmily", category: "IRL", transcript: "I waved back for a full minute before realizing he was waving at the person behind me.", token: "waving" },
  { type: "news", name: "Philip", category: "News", transcript: "The city says the bridge will remain closed for six weeks after the inspection.", token: "six" },
  { type: "visual", name: "Shroud", category: "Gaming", transcript: "That score cannot be right. We only have one round left.", token: "score", visualObservations: ["Scoreboard shows 12 to 11"] },
  { type: "profanity", name: "XQC", category: "Gaming", transcript: "What the fuck was that? I hit the shot and the game still counted a miss.", token: "shot" },
  { type: "long", name: "Pokimane", category: "Just Chatting", transcript: "I ordered the blue chair because the listing said it arrived assembled, but after three weeks the company sent a box with no screws, no instructions, and the wrong color, so customer support offered me five dollars.", token: "chair" },
  { type: "hypothetical", name: "Nmplol", category: "Just Chatting", transcript: "Could a company build these houses for around 100K if material prices dropped?", token: "100K" },
  { type: "sensitive", name: "Reporter", category: "News", transcript: "The guest accuses the company of illegal conduct, but no court has confirmed the allegation.", token: "accuses", review: true },
  { type: "no hook", name: "Streamer", category: "Just Chatting", transcript: "Um, yeah. Okay. Right. Sure.", token: "okay", review: true }
];

test("housing regression rejects the old generic caption and selects concrete evidence", async () => {
  const input = fixtures[0];
  const result = await generateCaptionIntelligence({ ...input, transcriptConfidence: 0.96 });
  assert.ok(result.selectedCaption);
  assert.match(result.selectedCaption, /million families|100K/i);
  assert.doesNotMatch(result.selectedCaption, /shares a wild take|on stream/i);
  assert.ok(result.qualityScore >= 85);
  assert.ok(result.accuracyScore >= 90);
  assert.equal(result.requiresHumanReview, false);
  assert.ok(result.candidates.some((candidate) => candidate.rejected));
});

test("generic caption detector hard-rejects reusable AI filler", () => {
  const input = fixtures[0];
  const analysis = buildCaptionAnalysis(input);
  const checked = validateCaptionCandidate({ text: "Nmplol Shares A Wild Take On Stream 👀", angle: "reaction" }, analysis, input, []);
  assert.equal(checked.rejected, true);
  assert.ok(checked.rejectionReasons.some((reason) => /banned|generic/i.test(reason)));
  const vague = validateCaptionCandidate({ text: "10 hours live and still doing this 💀", angle: "reaction" }, analysis, input, []);
  assert.equal(vague.rejected, true);
  assert.ok(vague.rejectionReasons.some((reason) => /generic/i.test(reason)));
});

test("human voice gate rejects the malformed captions seen in production", () => {
  const broken = [
    "Could Yeah, I'm not gonna die really happen? 👀",
    "Did i'm gonna try to kill you again, you can actually work?",
    "Zackrawrr using I wanted to show people what it was"
  ];
  for (const text of broken) {
    const result = captionHumanVoiceDiagnostics(text, { streamerName: "Zackrawrr" }, []);
    assert.ok(result.score < 65, `${text} should fail the human voice gate`);
    assert.ok(result.defects.length > 0);
  }
});

test("humanizer prompt uses failed candidates as rewrite material instead of final copy", () => {
  const input = { streamerName: "Jynxzi", category: "Gaming", transcript: "Yeah I'm not gonna die. I'm in like a fortress." };
  const analysis = buildCaptionAnalysis(input);
  const prompt = buildCaptionHumanizerPrompt(input, analysis, [{
    text: "Could Yeah, I'm not gonna die really happen?",
    angle: "curiosity_question",
    rejected: true,
    rejectionReasons: ["Caption fails the human voice gate"]
  }], [], []);
  assert.match(prompt, /final human rewrite desk/i);
  assert.match(prompt, /Could Yeah, I'm not gonna die really happen/i);
  assert.match(prompt, /4 to 12 words preferred/i);
});

test("structured generation and humanizer replace the transcript-copy one-shot path", async () => {
  let modelCalls = 0;
  const result = await generateCaptionIntelligence({
    streamerName: "Jynxzi",
    category: "Gaming",
    transcript: "I missed the last shot and my teammate started yelling at me",
    transcriptConfidence: 0.95
  }, {
    modelGenerate: async () => {
      modelCalls += 1;
      return { candidates: Array.from({ length: 12 }, (_, index) => ({
        text: index ? `one missed shot had his teammate yelling ${index}` : "his teammate LOST IT over one missed shot 😭",
        angle: "humanized_reaction",
        source_detail_ids: ["detail-1"]
      })) };
    }
  });
  assert.equal(modelCalls, 2, "caption generation should use a grounded pass followed by a humanizer pass");
  assert.doesNotMatch(result.selectedCaption || "", /shares|reveals|on stream/i);
});

test("plain transcript speech is rejected in favor of the human takeaway", async () => {
  const input = {
    streamerName: "IRL creator",
    category: "IRL",
    transcript: "I apologize, you can only use it for like 20 minutes after waiting this long",
    transcriptConfidence: 0.97
  };
  const analysis = buildCaptionAnalysis(input);
  const copied = captionTranscriptEchoDiagnostics("I apologize you can only use it for like 20 minutes", analysis);
  assert.equal(copied.copiedSpeech, true);
  assert.equal(copied.rawFirstPerson, true);
  const result = await generateCaptionIntelligence(input, {
    modelGenerate: async () => ({ candidates: [
      { text: "I apologize you can only use it for like 20 minutes", angle: "direct", source_detail_ids: ["detail-1"] },
      { text: "they waited all that time for 20 minutes 😭", angle: "humanized_reaction", source_detail_ids: ["detail-1"] },
      ...Array.from({ length: 10 }, (_, index) => ({
        text: `all that waiting just for 20 minutes ${index + 1} 😭`,
        angle: "humanized_reaction",
        source_detail_ids: ["detail-1"]
      }))
    ] })
  });
  const rawCopy = result.candidates.find((candidate) => candidate.text.startsWith("I apologize"));
  assert.equal(rawCopy?.rejected, true);
  assert.ok(rawCopy?.rejectionReasons.some((reason) => /copies spoken|first-person|formal speech/i.test(reason)));
  assert.match(result.selectedCaption || "", /wait|20 minutes/i);
  assert.doesNotMatch(result.selectedCaption || "", /^I apologize/i);
});

test("accuracy wins ties between equally catchy captions", async () => {
  const result = await generateCaptionIntelligence({
    streamerName: "Clix",
    category: "IRL",
    transcript: "We have been live for 10 hours. I am still signing these for everyone.",
    transcriptConfidence: 0.98
  }, {
    modelGenerate: async () => ({ candidates: [
      { text: "10 hours live and still doing this 💀", angle: "humanized_reaction", source_detail_ids: ["detail-1"] },
      { text: "live for 10 hours and still signing 💀", angle: "humanized_specific", source_detail_ids: ["detail-1"] },
      ...Array.from({ length: 10 }, () => ({
        text: "still signing after 10 hours live 💀",
        angle: "humanized_specific",
        source_detail_ids: ["detail-1"]
      }))
    ] })
  });
  assert.match(result.selectedCaption || "", /signing/i);
  assert.doesNotMatch(result.selectedCaption || "", /doing this/i);
  assert.ok(result.accuracyScore >= 90);
});

test("local fallback prefers a clean clip-page quote over a repeated narrator template", async () => {
  const result = await generateCaptionIntelligence({
    streamerName: "Jynxzi",
    category: "Gaming",
    transcript: "I'm fighting again, so try not to die. Yeah, I'm not gonna die. I'm in, like, a fortress.",
    transcriptConfidence: 0.95
  });
  assert.ok(result.selectedCaption);
  assert.doesNotMatch(result.selectedCaption, /really said|really happen|actually work/i);
  assert.ok(result.candidates[0].scores.humanVoice >= 82);
});

test("really-says narrator templates rank below the actual hook", () => {
  const narrator = captionHumanVoiceDiagnostics("bro really says he’s not gonna die 😭", {}, []);
  const quote = captionHumanVoiceDiagnostics("“I’m fighting again, so try not to die” 😭", {}, []);
  assert.ok(quote.score > narrator.score);
  assert.ok(narrator.defects.includes("Repeated clip-page template"));
});

test("Responses API parser reads structured output content instead of requiring SDK convenience fields", () => {
  const text = extractResponsesOutputText({
    output: [{
      type: "message",
      content: [{ type: "output_text", text: "{\"candidates\":[]}" }]
    }]
  });
  assert.equal(text, "{\"candidates\":[]}");
});

test("all thirty content fixtures preserve a real topic and never select banned filler", async () => {
  const results = await Promise.all(fixtures.map((fixture) => generateCaptionIntelligence({ ...fixture, streamerName: fixture.name, transcriptConfidence: fixture.review ? 0.68 : 0.94 })));
  assert.equal(results.length, 30);
  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    const result = results[index];
    const evidence = `${result.analysis.cleanedTranscript} ${result.analysis.primaryEvent} ${result.analysis.hookableDetails.map((detail) => detail.detail).join(" ")}`;
    assert.match(evidence, new RegExp(fixture.token, "i"), `${fixture.type} lost its expected topic`);
    if (result.selectedCaption) {
      assert.ok(!BANNED_CAPTION_PHRASES.some((phrase) => result.selectedCaption.toLowerCase().includes(phrase)), `${fixture.type} selected banned filler`);
      assert.ok(result.selectedCaption.split(/\s+/).length <= 19, `${fixture.type} caption is too long`);
    }
    if (fixture.review) assert.equal(result.requiresHumanReview, true, `${fixture.type} should require review`);
  }
});

test("hypothetical claims do not become completed outcomes", async () => {
  const result = await generateCaptionIntelligence({ ...fixtures[27], transcriptConfidence: 0.95 });
  assert.ok(result.selectedCaption);
  assert.doesNotMatch(result.selectedCaption, /built|completed|finished|will cost exactly/i);
  assert.match(result.selectedCaption, /could|thinks|100K/i);
});

test("unsupported numbers are rejected even when they are clickable", () => {
  const input = fixtures[5];
  const analysis = buildCaptionAnalysis(input);
  const checked = validateCaptionCandidate({ text: "Kai buys the car for $100K 😳", angle: "money_first" }, analysis, input, []);
  assert.equal(checked.rejected, true);
  assert.ok(checked.rejectionReasons.some((reason) => /number not found/i.test(reason)));
});

test("low-confidence and sensitive inputs enter review instead of fake hype", async () => {
  const [low, sensitive] = await Promise.all([
    generateCaptionIntelligence({ ...fixtures[29], transcriptConfidence: 0.4 }),
    generateCaptionIntelligence({ ...fixtures[28], transcriptConfidence: 0.95 })
  ]);
  assert.equal(low.requiresHumanReview, true);
  assert.equal(sensitive.requiresHumanReview, true);
  assert.doesNotMatch(low.selectedCaption || "", /crazy|wild|shocking/i);
  assert.doesNotMatch(sensitive.selectedCaption || "", /exposed|destroyed|caught/i);
});

test("recent caption fingerprints reduce repeated structures", async () => {
  const recentCaptions = ["Nmplol wants housing for a million families 😳", "Bro just planned an entire city 😭"];
  const input = { ...fixtures[0], streamerName: fixtures[0].name };
  const repeated = validateCaptionCandidate({
    text: "Nmplol wants housing for a million families 😳",
    angle: "direct_claim"
  }, buildCaptionAnalysis(input), input, recentCaptions);
  assert.ok(repeated.penalties.some((penalty) => /repeated/i.test(penalty.reason)));
  const result = await generateCaptionIntelligence(input, { recentCaptions });
  assert.notEqual(result.selectedCaption, "Nmplol wants housing for a million families 😳");
});

test("a failed model request does not fail a thirty-job batch", async () => {
  const settled = await Promise.allSettled(fixtures.map((fixture, index) => generateCaptionIntelligence(fixture, {
    modelGenerate: index === 7 ? async () => { throw new Error("provider timeout"); } : null
  })));
  assert.equal(settled.filter((entry) => entry.status === "fulfilled").length, 30);
  const recovered = settled[7].value;
  assert.match(recovered.modelError || "", /provider timeout/);
  assert.ok(recovered.candidates.length > 0);
});

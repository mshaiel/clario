import sqlite3
import json
import os

def seed_db():
    # Path setup
    db_path = 'data/techniques.db'
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 1. Create Tables
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS techniques (
            id TEXT PRIMARY KEY,
            disorder TEXT NOT NULL,
            name_en TEXT NOT NULL,
            name_ur TEXT NOT NULL,
            category TEXT NOT NULL,
            tier INTEGER NOT NULL,
            interaction_type TEXT NOT NULL,
            youtube_id_en TEXT,
            youtube_id_ur TEXT,
            diagram_file TEXT,
            steps_en TEXT NOT NULL,
            steps_ur TEXT NOT NULL,
            cam_test_type TEXT,
            scoring_config TEXT,
            display_order INTEGER DEFAULT 0
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS technique_sentences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            technique_id TEXT NOT NULL,
            language TEXT NOT NULL,
            difficulty INTEGER NOT NULL,
            sentence TEXT NOT NULL,
            phoneme_focus TEXT,
            word_count INTEGER,
            notes TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS technique_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            technique_id TEXT NOT NULL,
            session_date TEXT NOT NULL,
            score REAL,
            duration_sec INTEGER,
            session_data TEXT
        )
    ''')

    # 2. Define Data
    techniques = [
        # --- BLOCKS ---
        {
            "id": "easy_onset_blocks", "disorder": "blocks", "name_en": "Easy Onset", "name_ur": "Asaan Shurooaat",
            "category": "Fluency Shaping", "tier": 2, "interaction_type": "cam_scored", "diagram_file": "lips_easy_onset.svg",
            "cam_test_type": "blocks", "scoring_config": {"target_accuracy": 75},
            "steps_en": ["Relax lips and jaw fully before each word.", "Start the first sound gently — like a soft exhale, not a push.", "Gradually increase volume and airflow across each word.", "Never hold your breath before speaking.", "Record each sentence. We score your word initiations."],
            "steps_ur": ["Har lafz se pehle honth aur jhabra bilkul dhila karein.", "Pehli awaz naram shuru karein — halki hawa ki tarah.", "Lafz ke saath awaz aur hawa dhire barhaein.", "Bolne se pehle saans mat rokein.", "Jumla record karein. Hum score denge."],
            "en_seeds": ["Every apple is orange.", "Open arms always welcome.", "Our evening air is cool."],
            "ur_seeds": ["Aasman aaj bilkul saaf hai.", "Uski umeed abhi bhi hai.", "Apne aap par bharosa rakhein."],
            "phoneme_focus": None
        },
        {
            "id": "light_contact_blocks", "disorder": "blocks", "name_en": "Light Articulatory Contact", "name_ur": "Halka Aawaazi Raabta",
            "category": "Fluency Shaping", "tier": 2, "interaction_type": "cam_scored", "diagram_file": "tongue_alveolar_t.svg",
            "cam_test_type": "blocks", "scoring_config": {"target_accuracy": 75},
            "steps_en": ["Touch tongue or lips to target position very lightly — like touching a soap bubble.", "Avoid pressing hard. The contact should feel almost like a whisper.", "Start speaking immediately after light contact. Do not hold the position.", "If you feel tension building, release all pressure and restart.", "Record the sentences. We score your fluency onset."],
            "steps_ur": ["Zuban ya honton ko target jagah par bohat halka touch karein — jaise soap bubble.", "Zyaada dabao mat. Touch bilkul halka hona chahiye.", "Halka contact karte hi fauran bolna shuru karein.", "Agar tension mahsoos ho, pressure chhorain aur dobara shuru karein.", "Jumlay record karein. Hum aapki fluency score karenge."],
            "en_seeds": ["The tall tree stood still.", "Peter picked a pepper.", "Bobby bought a ball."],
            "ur_seeds": ["Billi bohat bari thi.", "Baap ne beta ko bulaya.", "Baar baar bolne ki koshish karo."],
            "phoneme_focus": None
        },
        {
            "id": "preparatory_sets_blocks", "disorder": "blocks", "name_en": "Preparatory Sets", "name_ur": "Tayyaari Ka Andaaz",
            "category": "Speech Modification", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "blocks", "scoring_config": {"target_accuracy": 75},
            "steps_en": ["Before each word, mentally plan the first sound.", "Pre-position your articulators LOOSELY before initiating.", "Take a gentle breath, then begin with smooth airflow.", "If tension arises before the word, pause, reset your breathing, and try again.", "Record the sentences below with this preparatory mindset."],
            "steps_ur": ["Har lafz se pehle, pehli awaz zehan mein plan karein.", "Bolne ke auzaar ko dhile andaaz mein position mein laaein.", "Halka saans lein, phir smooth hawa ke saath bolna shuru karein.", "Agar lafz se pehle tension ho, rukein, saans theek karein, dobara koshish karein.", "Neeche diye gaye jumlay is soch ke saath record karein."],
            "en_seeds": ["Please pass the paper.", "David drove downtown.", "Go get the green grapes."],
            "ur_seeds": ["Paani peene se pyaas bujhti hai.", "Door door tak safar kiya.", "Ghar ke bahar gaari khadi thi."],
            "phoneme_focus": None
        },
        {
            "id": "cancellation_blocks", "disorder": "blocks", "name_en": "Cancellation", "name_ur": "Cancellation Technique",
            "category": "Speech Modification", "tier": 3, "interaction_type": "repair", "diagram_file": None,
            "cam_test_type": "blocks", "scoring_config": {"technique": "cancellation", "cam_test_type": "blocks", "pause_threshold_ms": 400},
            "steps_en": ["Read the sentence and allow a block to occur naturally — do not fight it.", "When the block completes, pause for 1 to 2 full seconds.", "After the pause, say the stuttered word again using Easy Onset.", "Record the attempt. We detect: was there a pause after the block?", "If you do not stutter, intentionally induce a block to practice this."],
            "steps_ur": ["Jumla parho aur jaanbujhkar block hone do — mukaabalat mat karo.", "Block khatam hone ke baad, 1 se 2 second ke liye RUKEIN.", "Ruk-jaane ke baad, woh lafz dobara Asaan Shurooaat se bolein.", "Recording karein. Hum check karenge: kya block ke baad pause tha?", "Agar bilkul na takein, practice ke liye jaanbujhkar block karein."],
            "en_seeds": ["The big brown bear sat.", "Peter piper picked peppers.", "She sells seashells slowly."],
            "ur_seeds": ["Billi ne doodh piya.", "Bacha bahut roya.", "Saara din kaam kiya."],
            "phoneme_focus": None
        },
        {
            "id": "pullouts_blocks", "disorder": "blocks", "name_en": "Pull-Outs", "name_ur": "Pull-Out Technique",
            "category": "Speech Modification", "tier": 3, "interaction_type": "repair", "diagram_file": None,
            "cam_test_type": "blocks", "scoring_config": {"technique": "pullout", "cam_test_type": "blocks", "pause_threshold_ms": 200},
            "steps_en": ["Begin reading normally.", "When you enter a block, do NOT stop.", "While still in the block, gradually ease the tension and slide into the word.", "You modify the block in real time — you never stop speaking.", "Low scores on early attempts are expected — this takes practice."],
            "steps_ur": ["Normal parho.", "Jab block shuru ho — mat ruko.", "Block mein rehte hue, tension dhire kam karo aur lafz mein slide karo.", "Block ko real time mein modify karo — bolna band mat karo.", "Pehli koshishon mein low score aaega — yeh practice chahti hai."],
            "en_seeds": ["The cat sat on the mat.", "Big blue birds fly fast.", "Dogs dig deep ditches daily."],
            "ur_seeds": ["Kutta ghar ke andar aaya.", "Billi darwaze ke paas baithi.", "Din dhale andhere main gaye."],
            "phoneme_focus": None
        },
        {
            "id": "diaphragmatic_breathing", "disorder": "blocks", "name_en": "Diaphragmatic Breathing", "name_ur": "Diaphragmatic Breathing",
            "category": "Breathing and Relaxation", "tier": 1, "interaction_type": "passive", "diagram_file": "diaphragmatic_breathing.svg",
            "youtube_id_en": None, "scoring_config": None, "cam_test_type": None,
            "steps_en": ["Place one hand on your chest, one on your belly.", "Breathe in slowly for 4 counts — your belly should rise, chest stays still.", "Hold gently for 2 counts.", "Exhale slowly for 6 counts through slightly parted lips.", "Do 5 cycles before any speaking practice to reduce tension."],
            "steps_ur": ["Ek haath seene par, ek haath pait par rakhein.", "4 ginti tak dheere andar saans lein — pait utha chahiye, seena nahin.", "2 ginti tak rokein.", "Honton ko thoda khol kar 6 ginti tak dheere bahar saans lein.", "Kisi bhi bolne ki task se pehle 5 baar yeh cycle karein."],
            "en_seeds": ["Breathe in slowly and deeply.", "Relax your shoulders and neck.", "Feel your belly rise gently."],
            "ur_seeds": ["Dheere dheere saans lo.", "Kandhe aur gardan dhila karo.", "Pait ko upar aate dekho."],
            "phoneme_focus": None
        },
        {
            "id": "pmr_blocks", "disorder": "blocks", "name_en": "Progressive Muscle Relaxation", "name_ur": "Progressive Muscle Relaxation",
            "category": "Breathing and Relaxation", "tier": 1, "interaction_type": "passive", "diagram_file": None,
            "youtube_id_en": None, "scoring_config": None, "cam_test_type": None,
            "steps_en": ["Sit comfortably and close your eyes.", "Start with your feet: squeeze all muscles hard for 5 seconds, then release completely.", "Move up: calves, thighs, abdomen, chest, hands, arms, shoulders.", "Squeeze your eyes shut, clench jaw, scrunch nose — hold 5 sec, then release.", "Give special attention to lips, tongue, and jaw — release every trace of tension."],
            "steps_ur": ["Aaram se baith jao aur aankhein band karo.", "Pairon se shuru karo: 5 second zor se muscles khencho, phir chhodon.", "Upar aao: paindge, raan, pait, seena, haath, baahein, kandhe.", "Aankhein band karo, jabra bhaencho, naak skorin — 5 second, phir chhodon.", "Khaas taur par honth, zuban, jabra — wahin se saari tension chhodon."],
            "en_seeds": ["Relax your face and jaw completely.", "Let your shoulders drop and rest.", "Feel the tension leaving your body."],
            "ur_seeds": ["Chehra aur jabra bilkul dhila karo.", "Kandhe neeche chhodon aur aaram karo.", "Tension jism chhodte mehsoos karo."],
            "phoneme_focus": None
        },
        {
            "id": "voluntary_stuttering_blocks", "disorder": "blocks", "name_en": "Voluntary Stuttering", "name_ur": "Jaanbujhkar Takna",
            "category": "Cognitive and Desensitization", "tier": 1, "interaction_type": "passive", "diagram_file": None,
            "youtube_id_en": None, "scoring_config": None, "cam_test_type": None,
            "steps_en": ["Voluntary stuttering means taking control rather than fearing the stutter.", "Choose a word and intentionally block or repeat it.", "Example: say 'The c-c-cat sat on the mat.' Intentionally block on cat.", "Goal: reduce the surprise and shame by making stuttering feel chosen.", "Reflect: did voluntary stuttering feel different to involuntary?"],
            "steps_ur": ["Voluntary stuttering matlab apne stutter ka control apne haath mein lena.", "Koi lafz chunein aur jaanbujhkar block ya repeat karein.", "Misaal: 'Billi b-b-bari khush thi.' mein billi par block karein.", "Maqsad: stutter ko apni marzi se karke khauf aur sharam kam karna.", "Sochein: kya voluntary stuttering alag laga involuntary se?"],
            "en_seeds": ["The big cat sat here.", "Bobby bought a blue ball.", "Peter picked pink peppers."],
            "ur_seeds": ["Billi b-b-bari khush thi.", "Bacha b-b-bahut roya.", "Dost d-d-door chala gaya."],
            "phoneme_focus": None
        },

        # --- PROLONGATION ---
        {
            "id": "stretched_speech_prolongation", "disorder": "prolongation", "name_en": "Stretched Speech", "name_ur": "Kheenchi Hui Baat",
            "category": "Fluency Shaping", "tier": 3, "interaction_type": "rate", "diagram_file": None,
            "cam_test_type": None, "scoring_config": {"target_spm": 120, "tolerance_pct": 0.25},
            "steps_en": ["Read each sentence as SLOWLY as possible — stretch every vowel.", "Target: about 120 syllables per minute. Normal speech is 220-280.", "Every word should feel dramatically drawn out.", "Record the sentence. We will measure your syllable rate.", "A score of 75+ means you hit the slow-speech target."],
            "steps_ur": ["Har jumla jitna ho sake DHEERE parho — har vowel kheencho.", "Target: takreeban 120 syllables per minute. Normal speech 220-280 hai.", "Har lafz dramatically kheencha hona chahiye.", "Jumla record karein. Hum aapki syllable rate measure karenge.", "75+ score matlab aap ne slow-speech target hit kiya."],
            "en_seeds": ["The cat sat here.", "Blue skies look warm.", "She walks here now."],
            "ur_seeds": ["Aasman saaf hai.", "Billi yahan baithi hai.", "Woh dheere aaya."],
            "phoneme_focus": None
        },
        {
            "id": "rate_control_prolongation", "disorder": "prolongation", "name_en": "Rate Control", "name_ur": "Rate Control",
            "category": "Fluency Shaping", "tier": 3, "interaction_type": "rate", "diagram_file": None,
            "cam_test_type": None, "scoring_config": {"target_spm": 200, "tolerance_pct": 0.20},
            "steps_en": ["Speak at a controlled measured pace — slightly slower than natural.", "Target: around 200 syllables per minute.", "Imagine speaking to someone learning your language — unhurried and clear.", "Record the sentence. We measure your pace."],
            "steps_ur": ["Controlled pace se bolein — thoda apni normal speed se slow.", "Target: takreeban 200 syllables per minute.", "Sochein jaise kisi naye seekhne wale se bol rahe hain — sukoon se.", "Jumla record karein. Hum aapki speed measure karenge."],
            "en_seeds": ["Please take your time before speaking.", "The children played in the sun.", "Every morning she reads a book."],
            "ur_seeds": ["Bolne se pehle thodi der lo.", "Bachay dhoop mein khelte hain.", "Har subah woh kitaab parhti hai."],
            "phoneme_focus": None
        },
        {
            "id": "smooth_transitions_prolongation", "disorder": "prolongation", "name_en": "Smooth Transitions", "name_ur": "Smooth Transitions",
            "category": "Fluency Shaping", "tier": 3, "interaction_type": "phonation", "diagram_file": None,
            "cam_test_type": None, "scoring_config": {"max_gap_ms": 150},
            "steps_en": ["Flow from one word directly to the next — no gaps between words.", "Imagine speech as a single unbroken ribbon, not a string of beads.", "Record the sentence. We analyze silence gaps between each word.", "Any gap above 150ms between words will be flagged."],
            "steps_ur": ["Ek lafz se seedha aglay lafz par — beech mein koi gap nahin.", "Speech ko ek toota hua ribbon samjho, motiyon ki mala nahin.", "Jumla record karein. Hum alfaaz ke darmiyan khamoshi analyze karenge.", "150ms se zyaada koi bhi gap flag ho ga."],
            "en_seeds": ["The rain falls softly now.", "We all need some rest.", "Her voice flows like water."],
            "ur_seeds": ["Barish dheere dheere parti hai.", "Hum sab ko aaram chahiye.", "Uski awaz paani ki tarah hai."],
            "phoneme_focus": None
        },
        {
            "id": "continuous_phonation_prolongation", "disorder": "prolongation", "name_en": "Continuous Phonation", "name_ur": "Lagataar Awaaz",
            "category": "Fluency Shaping", "tier": 3, "interaction_type": "phonation", "diagram_file": None,
            "cam_test_type": None, "scoring_config": {"max_gap_ms": 100},
            "steps_en": ["Maintain continuous airflow from first word to last — no silence between words.", "Think of humming quietly between words to keep voicing active.", "Record the sentence. We score continuity of your voice signal."],
            "steps_ur": ["Pehle lafz se aakhri lafz tak hawa jaari rakhein — alfaaz ke beech khamoshi nahin.", "Alfaaz ke beech dheere gungunane ka tasawwur karein.", "Jumla record karein. Hum aapki awaaz ki continuity score karenge."],
            "en_seeds": ["The warm sun melts the snow.", "She walks along the shore.", "Birds sing in the tall trees."],
            "ur_seeds": ["Garm dhoop barf pighalati hai.", "Woh kinare kinare chalti hai.", "Darakhton mein parindey gaate hain."],
            "phoneme_focus": None
        },
        {
            "id": "daf_prolongation", "disorder": "prolongation", "name_en": "DAF Practice", "name_ur": "DAF Practice",
            "category": "Fluency Shaping", "tier": 3, "interaction_type": "daf", "diagram_file": None,
            "cam_test_type": None, "scoring_config": {"default_delay_ms": 150, "min_delay_ms": 50, "max_delay_ms": 250},
            "steps_en": ["IMPORTANT: Use wired headphones only — Bluetooth adds unpredictable delay.", "Tap Start Session. You will hear your voice played back with a delay.", "Start reading slowly. The delay naturally encourages slower speech.", "Adjust the delay slider to find your comfort zone — usually 100 to 200ms.", "Practice for at least 2 minutes. Self-report your fluency at the end."],
            "steps_ur": ["ZAROORI: Sirf wired headphones use karein — Bluetooth apni delay add karta hai.", "Start Session tap karein. Aapko apni awaaz delay ke saath sunai degi.", "Dheere parho. Delay naturally speech slow karti hai.", "Delay slider adjust karein — usually 100 se 200ms comfortable hota hai.", "Kam az kam 2 minute practice karein. Aakhir mein fluency khud rate karein."],
            "en_seeds": ["The blue sky is clear today.", "Speak slowly and breathe deeply.", "Every word needs time to form."],
            "ur_seeds": ["Aasman aaj saaf hai.", "Dheere bolo aur gehri saans lo.", "Har lafz ko waqt chahiye."],
            "phoneme_focus": None
        },

        # --- REPETITION ---
        {
            "id": "bouncing_repetition", "disorder": "repetition", "name_en": "Bouncing Technique", "name_ur": "Bouncing Technique",
            "category": "Fluency Shaping", "tier": 3, "interaction_type": "rhythm", "diagram_file": None,
            "cam_test_type": None, "scoring_config": {"expected_bpm": 60},
            "steps_en": ["Bouncing means gently repeating the first sound of a word on purpose.", "Say b-b-b-ball with soft rhythmic bounces — one per second.", "Gradually reduce bounces across sessions until words come directly.", "Tap the screen button once per bounce while speaking.", "We score the regularity of your tapping rhythm."],
            "steps_ur": ["Bouncing matlab lafz ki pehli awaz jaanbujhkar naram taur par dobara bolna.", "b-b-b-billi kaho — har bounce 1 second mein naram aur rhythmic.", "Sessions ke saath bounces ki tadaad kam karte jao.", "Har bounce par screen button tap karo.", "Hum aapki tapping rhythm ki regularity score karenge."],
            "en_seeds": ["The big ball bounced back.", "Bobby brought blue berries.", "Bears bite big branches."],
            "ur_seeds": ["Billi b-b-bari thi.", "Bacha b-b-bahut khush tha.", "Barish b-b-bohat tez thi."],
            "phoneme_focus": None
        },
        {
            "id": "chanting_repetition", "disorder": "repetition", "name_en": "Chanting and Rhythmic Speech", "name_ur": "Laya Dar Baat",
            "category": "Practice and Drill", "tier": 3, "interaction_type": "rhythm", "diagram_file": None,
            "cam_test_type": None, "scoring_config": {"expected_bpm": 72},
            "steps_en": ["Chanting removes prosodic variation which reduces repetitions temporarily.", "Read each sentence to the beat shown — 72 BPM, one syllable per beat.", "Keep it even and song-like. It will sound unusual — that is correct.", "Tap the screen once per syllable as you speak.", "We score your beat consistency."],
            "steps_ur": ["Chanting se prosodic variation khatam hoti hai jo repetitions temporarily kam karti hai.", "Screen par dikhaye beat ke saath jumla parho — 72 BPM, ek syllable per beat.", "Baraabar aur gaane wali style mein. Ajeeb lagega — theek hai.", "Bolte waqt har syllable par ek baar screen tap karo.", "Hum aapka beat consistency score karenge."],
            "en_seeds": ["The cat sat on the mat.", "Rain falls on the plain.", "One two three four five."],
            "ur_seeds": ["Billi chadar par baithi.", "Barish maidan par parti hai.", "Ek do teen chaar paanch."],
            "phoneme_focus": None
        },
        {
            "id": "cognitive_restructuring_repetition", "disorder": "repetition", "name_en": "Cognitive Restructuring", "name_ur": "Soch Badalna",
            "category": "Cognitive and Desensitization", "tier": 1, "interaction_type": "passive", "diagram_file": None,
            "cam_test_type": None, "scoring_config": None,
            "steps_en": ["Identify one negative thought about your repetitions.", "Example: People think I am stupid when I repeat.", "Write a realistic alternative: My repetition has no connection to intelligence.", "Read your realistic thought aloud 5 times — this reinforces the new belief.", "Over time this rewires the emotional response to repetitions."],
            "steps_ur": ["Apni repetitions ke baare mein ek negative soch identify karein.", "Misaal: Jab main repeat karta hoon log sochte hain main bewakoof hoon.", "Ek realistic alternative likhein: Meri repetition aqalmandi se bilkul alag hai.", "Apni realistic soch 5 baar zor se parho — yeh nai soch ko mazboot karta hai.", "Waqt ke saath yeh repetitions ki emotional response badal deta hai."],
            "en_seeds": ["My speech does not define my worth.", "I am more than my stutter.", "Progress happens one step at a time."],
            "ur_seeds": ["Meri speech meri qadr tay nahin karti.", "Main apne stutter se zyaada hoon.", "Taraqi ek qadam ek waqt mein hoti hai."],
            "phoneme_focus": None
        },
        {
            "id": "situation_hierarchy_repetition", "disorder": "repetition", "name_en": "Situation Hierarchy", "name_ur": "Halaat Ki Fahrast",
            "category": "Cognitive and Desensitization", "tier": 1, "interaction_type": "passive", "diagram_file": None,
            "cam_test_type": None, "scoring_config": None,
            "steps_en": ["Build a personal list of speaking situations from least to most feared.", "Level 1: Talking to yourself in a mirror.", "Level 2: Talking to one trusted family member.", "Level 3: Calling a business to ask a simple question.", "Level 4: Speaking in a small group.", "Level 5: Formal presentation or job interview.", "Practice the current level daily before moving up."],
            "steps_ur": ["Bolne ke halaat ki personal list banao — sabse aasaan se mushkil tak.", "Level 1: Aaine ke saamne khud se baat karna.", "Level 2: Kisi qareeb ghar wale se baat karna.", "Level 3: Kisi dukaan ko phone karke time poochna.", "Level 4: Chhote group mein bolna.", "Level 5: Formal presentation ya job interview.", "Agle level par jaane se pehle current level roz practice karo."],
            "en_seeds": ["I can speak in this situation.", "Each practice makes me stronger.", "I will try one level at a time."],
            "ur_seeds": ["Main is situation mein bol sakta hoon.", "Har practice mujhe mazboot banati hai.", "Main ek level ek waqt try karoonga."],
            "phoneme_focus": None
        },

        # --- VELAR FRONTING ---
        {
            "id": "minimal_pairs_velar", "disorder": "velar_fronting", "name_en": "Minimal Pairs Contrast", "name_ur": "Milte Julte Lafz",
            "category": "Contrastive Therapy", "tier": 2, "interaction_type": "cam_scored", "diagram_file": "minimal_pairs_velar.svg",
            "cam_test_type": "velar_fronting", "scoring_config": {"target_accuracy": 80},
            "steps_en": ["k and g are BACK sounds — tongue touches soft palate at back of mouth.", "t and d are FRONT sounds — tongue touches just behind top teeth.", "Say each word in the pair carefully.", "We score whether you produced the back sound correctly."],
            "steps_ur": ["k aur g PEECHE ki awaazein hain — zuban muh ke peeche soft palate ko touch kare.", "t aur d AAGE ki awaazein hain — zuban upar ke daanton ke peeche touch kare.", "Pair ka har lafz dhyan se bolein.", "Hum score karenge ke aapne back sound sahi bola ya nahin."],
            "en_seeds": ["The black cat caught a cold goose.", "Keep your coat in the back car.", "Get the big bag from the garage."],
            "ur_seeds": ["Kaala kutta garam gaye ke paas tha.", "Gaari ke peeche kali gaddi thi.", "Kaafi gehri gufaa thi."],
            "phoneme_focus": "k,g"
        },
        {
            "id": "cough_to_k_velar", "disorder": "velar_fronting", "name_en": "Cough to K Shaping", "name_ur": "Khansi Se K Banana",
            "category": "Placement and Articulation", "tier": 2, "interaction_type": "cam_scored", "diagram_file": "tongue_velar_k.svg",
            "cam_test_type": "velar_fronting", "scoring_config": {"target_accuracy": 75},
            "steps_en": ["Make a short cough: ahem. Feel your tongue hit the back of your throat.", "That back tongue contact is exactly the k sound.", "Transition: cough then ka then cat.", "Practice: cough ka kaala in Urdu or cat in English.", "Record the practice words. We check if your k is at the back."],
            "steps_ur": ["Ek chhoti khansi karein: ahem. Gale ke peeche zuban lagti hai.", "Woh peeche wala touch wohi k ki awaaz hai.", "Transition: khansi phir ka phir kaala.", "Practice: khansi ka kaala.", "Practice ke alfaaz record karein. Hum check karenge k sahi bola ya nahin."],
            "en_seeds": ["The cat caught a cold.", "Keep the key in the car.", "Can you see the kite up there."],
            "ur_seeds": ["Kaala kutta bhaaga.", "Kite kaafi oopar thi.", "Khana khaane ka waqt hai."],
            "phoneme_focus": "k"
        },
        {
            "id": "gravity_trick_velar", "disorder": "velar_fronting", "name_en": "Gravity Trick and Tongue Depressor", "name_ur": "Gravity Trick",
            "category": "Placement and Articulation", "tier": 1, "interaction_type": "passive", "diagram_file": "gravity_trick_k.svg",
            "cam_test_type": None, "scoring_config": None,
            "steps_en": ["Gravity Trick: Tilt your head back slightly when producing k and g.", "The tilt pulls the tongue tip down forcing the back of tongue to rise.", "Try saying kaa with head tilted back — feel the difference.", "Tongue Depressor: Press finger or clean spoon on front of tongue pressing it down.", "This forces the back to rise for k contact.", "Drill 10 repetitions of ka ki ku ko with this physical cue."],
            "steps_ur": ["Gravity Trick: k aur g bolte waqt sar thoda peeche jhukao.", "Jhukao zuban ki nauk neechay kheenchta hai jisse peeche wala hissa upar aata hai.", "Sar jhuka ke kaa bolne ki koshish karein — farq mehsoos karein.", "Tongue Depressor: Saaf ungli ya chamcha zuban ke aage rakhein aur dhabaein.", "Isse peeche upar aata hai k ke liye.", "ka ki ku ko ke 10 baar is physical cue se practice karein."],
            "en_seeds": ["Tilt your head and say ka.", "Press your tongue down gently.", "Say ka ki ku ko slowly."],
            "ur_seeds": ["Sar peeche jhuka kar ka kaho.", "Zuban ko dheere dbaao.", "Ka ki ku ko aahista kaho."],
            "phoneme_focus": "k,g"
        },
        {
            "id": "gargling_g_velar", "disorder": "velar_fronting", "name_en": "Gargling to G", "name_ur": "Gargling Se G",
            "category": "Placement and Articulation", "tier": 1, "interaction_type": "passive", "diagram_file": None,
            "cam_test_type": None, "scoring_config": None,
            "steps_en": ["Take a small sip of water and tilt your head back.", "Gargle for 5 seconds. Feel the deep vibration in your throat.", "That vibration IS the g position. Spit out the water.", "Immediately say ga ga ga capturing the same deep position.", "Practice before every velar fronting session."],
            "steps_ur": ["Thoda paani lein aur sar peeche jhukaaein.", "5 second gargle karein. Gale mein gehri vibration feel karein.", "Woh vibration g wali position hai. Paani thook dein.", "Fauran ga ga ga bolein us gale wali position ko pakad ke.", "Roz velar fronting exercises se pehle practice karein."],
            "en_seeds": ["Gargle then say ga ga ga.", "The goat ate green grass.", "Go get the big green bag."],
            "ur_seeds": ["Gargle karo phir ga ga ga kaho.", "Bakri ne hara ghaas khaya.", "Jaake bari harri thaili lo."],
            "phoneme_focus": "g"
        },
        {
            "id": "metaphon_velar", "disorder": "velar_fronting", "name_en": "Metaphon Awareness", "name_ur": "Awaaz Ki Jagah Samajhna",
            "category": "Awareness and Monitoring", "tier": 1, "interaction_type": "client_game", "diagram_file": None,
            "cam_test_type": None, "scoring_config": None,
            "steps_en": ["Metaphon builds awareness of WHERE in the mouth sounds are made.", "Back sounds: k and g — tongue touches the back soft palate.", "Front sounds: t and d — tongue touches the ridge behind top teeth.", "Game: 10 words will be read. Tap BACK or FRONT for each.", "Target: 8 out of 10 correct before moving to production."],
            "steps_ur": ["Metaphon muh mein awaaz KAHAN banti hai us ka shuoor deta hai.", "Peeche ki awaazein: k aur g — zuban peeche soft palate ko touch kare.", "Aage ki awaazein: t aur d — zuban upar ke daanton ke peeche ridge ko touch kare.", "Game: 10 alfaaz sunenge. Har ek ke liye BACK ya FRONT tap karein.", "Target: agle level se pehle 10 mein se 8 sahi."],
            "en_seeds": ["Is this a back sound or front sound.", "The key starts with a back sound.", "The tea starts with a front sound."],
            "ur_seeds": ["Kya yeh peeche ki awaaz hai ya aage ki.", "Key peeche ki awaaz se shuru hoti hai.", "Tea aage ki awaaz se shuru hoti hai."],
            "phoneme_focus": "k,g,t,d"
        },
        {
            "id": "cycles_velar", "disorder": "velar_fronting", "name_en": "Cycles Approach", "name_ur": "Cycles Approach",
            "category": "Practice and Drill", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "velar_fronting", "scoring_config": {"session_type": "cycles", "phoneme_rotation": ["k", "g", "ng"], "cycle_duration_sec": 60},
            "steps_en": ["The Cycles Approach rotates through target sounds in 60 second windows.", "Round 1: 60 seconds — only k words.", "Round 2: 60 seconds — only g words.", "Round 3: 60 seconds — ng words like sing ring song.", "Three recordings scored individually."],
            "steps_ur": ["Cycles Approach target sounds ko 60 second windows mein rotate karta hai.", "Round 1: 60 second — sirf k wale alfaaz.", "Round 2: 60 second — sirf g wale alfaaz.", "Round 3: 60 second — ng wale alfaaz jaise sing ring song.", "Teen recordings alag alag score hongi."],
            "en_seeds": ["The cat caught a cold.", "Go get the green grapes.", "Sing the ring song now."],
            "ur_seeds": ["Kaala kutta bhaga.", "Jaake hara angoor lo.", "Gaana gaao abhi."],
            "phoneme_focus": "k,g,ng"
        },

        # --- STOPPING ---
        {
            "id": "minimal_pairs_stopping", "disorder": "stopping", "name_en": "Minimal Pairs Contrast", "name_ur": "Milte Julte Lafz",
            "category": "Contrastive Therapy", "tier": 2, "interaction_type": "cam_scored", "diagram_file": "airflow_fricative_s.svg",
            "cam_test_type": "stopping", "scoring_config": {"target_accuracy": 80},
            "steps_en": ["Stopping replaces fricatives like f v s z sh with stops like p b t d.", "Your goal is to HOLD the airflow for fricatives — they need continuous air.", "Say sss — feel the continuous hiss. Now say ttt — notice it stops.", "Practice the word pairs. We check if you are sustaining the fricative."],
            "steps_ur": ["Stopping fricatives jaise f v s z sh ki jagah stops jaise p b t d use karta hai.", "Aapka goal fricatives ke liye hawa JAARI rakhna hai.", "sss kaho — continuous hiss feel karo. Ab ttt kaho — ruk jaata hai.", "Word pairs practice karo. Hum check karenge ke aap fricative sahi bol rahe hain."],
            "en_seeds": ["She sells shells by the sea.", "The sun shines in the summer sky.", "Five fine fish swim fast."],
            "ur_seeds": ["Samandar ke kinare seetiyaan bechti hai.", "Garmiyon mein suraj chamakta hai.", "Paanch machchhiyaan tez tairati hain."],
            "phoneme_focus": "s,f,sh"
        },
        {
            "id": "snake_sound_stopping", "disorder": "stopping", "name_en": "Snake Sound S Shaping", "name_ur": "Saanp Ki Awaaz S",
            "category": "Placement and Articulation", "tier": 2, "interaction_type": "cam_scored", "diagram_file": "airflow_fricative_s.svg",
            "cam_test_type": "stopping", "scoring_config": {"target_accuracy": 75},
            "steps_en": ["Make the snake sound: a long continuous sssssss for 5 seconds.", "Feel the continuous airflow. s is a SUSTAINED sound not a burst.", "Attach a vowel: sss aaa. Then sa sa sa.", "Build up: sa then sat then Saturday.", "Record target words. We check if your s is sustained."],
            "steps_ur": ["Saanp ki awaaz banao: ek lamba continuous sssssss 5 second ke liye.", "Continuous hawa feel karo. s ek SUSTAINED awaaz hai burst nahin.", "Vowel lagao: sss aaa. Phir sa sa sa.", "Build up: sa phir sat phir Saturday.", "Target alfaaz record karo. Hum check karenge k tera s sustained hai."],
            "en_seeds": ["The snake slid slowly south.", "Six silly seals sat still.", "Susan sees seven silver stars."],
            "ur_seeds": ["Saanp aahista aahista dakshin gaya.", "Chhe bewaqoof mohnay chup baithe.", "Sara ne saat sitaare dekhe."],
            "phoneme_focus": "s"
        },
        {
            "id": "airflow_awareness_stopping", "disorder": "stopping", "name_en": "Airflow Awareness", "name_ur": "Hawa Ka Shuoor",
            "category": "Placement and Articulation", "tier": 1, "interaction_type": "passive", "diagram_file": "airflow_fricative_s.svg",
            "cam_test_type": None, "scoring_config": None,
            "steps_en": ["Hold your hand 6 inches from your mouth.", "Say sss — feel continuous warm air for 3 or more seconds.", "Now say ttt — the air stops immediately. That is a stop.", "All fricatives need continuous airflow.", "Practice sustaining s for 5 seconds before using it in words."],
            "steps_ur": ["Haath muh se 6 inch door rakhein.", "sss kaho — 3 ya zyaada second tak lagataar garm hawa feel karo.", "Ab ttt kaho — hawa fauran ruk jaati hai. Yeh ek stop hai.", "Tamam fricatives ko lagataar hawa chahiye.", "Alfaaz mein use karne se pehle s ko 5 second tak sustain karne ki practice karo."],
            "en_seeds": ["Feel the air from the s sound.", "The s sound never stops suddenly.", "Hold the sound and keep air flowing."],
            "ur_seeds": ["s ki awaaz se hawa feel karo.", "s ki awaaz achanak nahin rukti.", "Awaaz pakdo aur hawa jaari rakho."],
            "phoneme_focus": "s,f"
        },
        {
            "id": "gradual_approximation_stopping", "disorder": "stopping", "name_en": "Gradual Approximation", "name_ur": "Dhire Dhire Qarib Ana",
            "category": "Fluency Shaping", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "stopping", "scoring_config": {"target_accuracy": 75},
            "steps_en": ["Start from a sound you can produce like a whispered h.", "Gradually shape it toward the target fricative: h then f then v.", "Each step should sound slightly more like the target.", "Record each target word. We track progress toward the target fricative."],
            "steps_ur": ["Ek aise awaaz se shuru karo jo tum bol sako jaise whispered h.", "Dhire dhire target fricative ki taraf shape karo: h phir f phir v.", "Har qadam target se thoda zyaada milna chahiye.", "Har target word record karo. Hum target fricative ki taraf progress track karenge."],
            "en_seeds": ["His fan fell on the floor.", "Five frogs found fresh food.", "Vivid violet violets vary."],
            "ur_seeds": ["Uska pankha zameen par gira.", "Paanch mendak taaza khaana laaye.", "Surkh banafshi phool mukhtalif hote hain."],
            "phoneme_focus": "f,v"
        },
        {
            "id": "cycles_stopping", "disorder": "stopping", "name_en": "Cycles Approach", "name_ur": "Cycles Approach",
            "category": "Practice and Drill", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "stopping", "scoring_config": {"session_type": "cycles", "phoneme_rotation": ["s", "z", "f", "v", "sh"], "cycle_duration_sec": 60},
            "steps_en": ["The Cycles Approach rotates through target fricative sounds.", "Round 1: s words for 60 seconds.", "Round 2: f words for 60 seconds.", "Round 3: sh words for 60 seconds.", "Each round recorded and scored separately."],
            "steps_ur": ["Cycles Approach target fricative sounds ko rotate karta hai.", "Round 1: 60 second s wale alfaaz.", "Round 2: 60 second f wale alfaaz.", "Round 3: 60 second sh wale alfaaz.", "Har round alag record aur score hoga."],
            "en_seeds": ["She sells sea shells slowly.", "Five fresh fish swim fast.", "Shoes shine in the sunlight."],
            "ur_seeds": ["Samandar ke seetiyaan dhire bechti hai.", "Paanch taazi maachhliyaan tezi tairati hain.", "Jutiyan dhoop mein chamakti hain."],
            "phoneme_focus": "s,f,sh"
        },

        # --- GLIDING ---
        {
            "id": "minimal_pairs_gliding", "disorder": "gliding", "name_en": "Minimal Pairs Contrast", "name_ur": "Milte Julte Lafz",
            "category": "Contrastive Therapy", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "gliding", "scoring_config": {"target_accuracy": 80},
            "steps_en": ["Gliding replaces r or l with w or y sounds.", "For r: curl your tongue tip back or bunch the middle upward.", "For l: touch the alveolar ridge just behind your top teeth.", "Say the pairs. We check if you produced the liquid consonant correctly."],
            "steps_ur": ["Gliding r ya l ki jagah w ya y awaaz use karta hai.", "r ke liye: zuban ki nauk peeche curl karo ya beech wala hissa upar karo.", "l ke liye: upar ke daanton ke peechay alveolar ridge ko touch karo.", "Pairs bolein. Hum check karenge ke aapne liquid consonant sahi bola ya nahin."],
            "en_seeds": ["The red rose raced along the road.", "Larry really loves the library.", "Roll the round rock down the road."],
            "ur_seeds": ["Laal gulaab raste par daudta raha.", "Laila ko library bohat pasand hai.", "Gol pathar raste par larhka."],
            "phoneme_focus": "r,l"
        },
        {
            "id": "tongue_bunching_r_gliding", "disorder": "gliding", "name_en": "Tongue Bunching for R", "name_ur": "R Ke Liye Zuban Banana",
            "category": "Placement and Articulation", "tier": 2, "interaction_type": "cam_scored", "diagram_file": "tongue_bunching_r.svg",
            "cam_test_type": "gliding", "scoring_config": {"target_accuracy": 75},
            "steps_en": ["The bunched r does not need a curled tongue tip.", "Instead bunch the MIDDLE of your tongue upward toward hard palate.", "Your tongue tip can point DOWN behind lower teeth — that is fine.", "Say err with bunched mid-tongue. Feel the back of mouth narrow.", "Build: err then red then really then record."],
            "steps_ur": ["Bunched r ke liye zuban ki nauk curl karne ki zaroorat nahin.", "Badle mein zuban ka BEECH wala hissa hard palate ki taraf upar karo.", "Zuban ki nauk neechay ke daanton ke peeche neeche ho sakti hai — theek hai.", "Bunched mid-tongue ke saath err kaho. Muh ka peeche wala hissa tang hoga.", "Build: err phir red phir really phir record."],
            "en_seeds": ["Robert ran around the red barn.", "The rabbit reached the river rocks.", "Really rare red roses grow here."],
            "ur_seeds": ["Robert laal khal ke gird dauda.", "Khargosh darya ke patthron tak pahuncha.", "Bohat kam laal gulaab yahaan ugte hain."],
            "phoneme_focus": "r"
        },
        {
            "id": "retroflex_r_gliding", "disorder": "gliding", "name_en": "Retroflex R Shaping", "name_ur": "R Ko Morhna",
            "category": "Placement and Articulation", "tier": 2, "interaction_type": "cam_scored", "diagram_file": "tongue_retroflex_r.svg",
            "cam_test_type": "gliding", "scoring_config": {"target_accuracy": 75},
            "steps_en": ["Retroflex r uses a tongue tip that curls BACK.", "Say ttt — your tongue tip is at the alveolar ridge.", "Now curl it back slightly while maintaining height — say rrr.", "dr words help — drive dream drip — the d sets the position for r."],
            "steps_ur": ["Retroflex r mein zuban ki nauk PEECHE curl hoti hai.", "ttt kaho — zuban ki nauk alveolar ridge par hai.", "Ab usey thoda peeche curl karo height barhate hue — rrr kaho.", "dr wale alfaaz madad karte hain — drive dream drip — d position set karta hai."],
            "en_seeds": ["Drive the truck down the road.", "Draw a red dragon on paper.", "Drop the drum and run away."],
            "ur_seeds": ["Truck raste par chalao.", "Kaagaz par laal ajdaha banaao.", "Drum girado aur bhaag jao."],
            "phoneme_focus": "r"
        },
        {
            "id": "smile_trick_l_gliding", "disorder": "gliding", "name_en": "Smile Trick and Alveolar Tapping for L", "name_ur": "L Ke Liye Muskurahat",
            "category": "Placement and Articulation", "tier": 2, "interaction_type": "cam_scored", "diagram_file": "tongue_alveolar_t.svg",
            "cam_test_type": "gliding", "scoring_config": {"target_accuracy": 75},
            "steps_en": ["Smile broadly and place your tongue tip on the ridge just behind top teeth.", "That ridge is the alveolar ridge. l requires this contact.", "Tapping drill: la la la la la rapidly with a wide smile.", "Record target l words: light love lion ball bell all fill."],
            "steps_ur": ["Khul ke muskurao aur zuban ki nauk upar ke daanton ke peeche ridge par rakho.", "Woh ridge alveolar ridge hai. l ke liye yeh contact zaroori hai.", "Tapping drill: la la la la la tezi se khuli muskurahat ke saath.", "Target l alfaaz record karo: light love lion ball bell all fill."],
            "en_seeds": ["The little lion loves to leap.", "Lily placed blue bells along the lane.", "All the tall walls fell slowly."],
            "ur_seeds": ["Chhota sher koodna pasand karta hai.", "Lily ne neele ghantiyan gali mein lagayi.", "Tamam oonchi deewaren dheere giri."],
            "phoneme_focus": "l"
        },
        {
            "id": "mirror_feedback_gliding", "disorder": "gliding", "name_en": "Mirror and Tongue Feedback", "name_ur": "Aaine Mein Dekhna",
            "category": "Awareness and Monitoring", "tier": 1, "interaction_type": "passive", "diagram_file": None,
            "cam_test_type": None, "scoring_config": None,
            "steps_en": ["Hold a mirror in front of your face while you speak.", "For r: verify your tongue does NOT come forward to touch the teeth.", "For l: verify your tongue TIP touches the alveolar ridge behind upper teeth.", "Repeat each target word slowly while watching your tongue position."],
            "steps_ur": ["Bolte waqt saamne aaina rakhein.", "r ke liye: yaqeen karo zuban daanton ko touch karne aage nahin aayi.", "l ke liye: yaqeen karo zuban ki NAUK upar ke daanton ke peeche ridge ko touch kare.", "Har target word dheere dohraao aur apni zuban ki jagah dekhte raho."],
            "en_seeds": ["Watch your tongue in the mirror.", "Does your tongue touch the right place.", "Check your lip and tongue position."],
            "ur_seeds": ["Aaine mein apni zuban dekho.", "Kya zuban sahi jagah touch kar rahi hai.", "Hont aur zuban ki jagah check karo."],
            "phoneme_focus": "r,l"
        },
        {
            "id": "vowel_r_gliding", "disorder": "gliding", "name_en": "Vowel Based R", "name_ur": "Vowel Se R",
            "category": "Fluency Shaping", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "gliding", "scoring_config": {"target_accuracy": 75},
            "steps_en": ["Start from the neutral uh vowel and slide into r.", "Say uh-rrr repeatedly. The neutral vowel places mouth in right position.", "Attach words: uh-rrr-ed becomes red. uh-rrr-oo becomes room.", "Record the r word list. This bypasses initial placement difficulty."],
            "steps_ur": ["Neutral uh vowel se shuru karo aur r mein slide karo.", "uh-rrr baar baar kaho. Neutral vowel muh sahi position mein lagata hai.", "Alfaaz lagao: uh-rrr-ed se red banta hai. uh-rrr-oo se room banta hai.", "r wale alfaaz ki list record karo. Yeh shuruaati placement mushkil se bachata hai."],
            "en_seeds": ["The road runs around the river.", "Round rocks roll down rapidly.", "Rich red roses grew in rows."],
            "ur_seeds": ["Rasta darya ke gird jaata hai.", "Gol pathar tezi se larhkte hain.", "Ameer laal gulaab qataaron mein ugey."],
            "phoneme_focus": "r"
        },

        # --- CLUSTER REDUCTION ---
        {
            "id": "sound_chaining_cluster", "disorder": "cluster_reduction", "name_en": "Sound Chaining Build Up", "name_ur": "Awaaz Jorhna",
            "category": "Practice and Drill", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "cluster_reduction", "scoring_config": {"target_accuracy": 80},
            "steps_en": ["Cluster reduction removes consonants — play becomes pay. We add them back.", "Step 1: l alone — say it 5 times.", "Step 2: Add the onset: pl — hold both consonants.", "Step 3: Add vowel and coda: play.", "Record the full word. We score if both consonants are present."],
            "steps_ur": ["Cluster reduction consonants hatata hai — play se pay banta hai. Hum waapas lagate hain.", "Step 1: sirf l — 5 baar kaho.", "Step 2: Onset lagao: pl — dono consonants pakdo.", "Step 3: Vowel aur coda lagao: play.", "Poora lafz record karo. Hum score karenge ke dono consonants hain ya nahin."],
            "en_seeds": ["Please play the blue guitar.", "Try to bring the plastic plate.", "Green grapes grow on black branches."],
            "ur_seeds": ["Kripya neeli gitar bajao.", "Plastic plate laane ki koshish karo.", "Kale shaakhon par hare angoor ugte hain."],
            "phoneme_focus": "pl,tr,bl,gr"
        },
        {
            "id": "minimal_pairs_cluster", "disorder": "cluster_reduction", "name_en": "Minimal Pairs Contrast", "name_ur": "Milte Julte Lafz",
            "category": "Contrastive Therapy", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "cluster_reduction", "scoring_config": {"target_accuracy": 80},
            "steps_en": ["Cluster reduction drops consonants from clusters: play becomes pay.", "Listen to both words in each pair — notice the missing consonant.", "Say the full cluster word each time.", "We score if the cluster consonants are both present."],
            "steps_ur": ["Cluster reduction clusters se consonants hatata hai: play se pay banta hai.", "Pair ke dono alfaaz sunein — missing consonant note karein.", "Har baar poora cluster word bolein.", "Hum score karenge ke dono cluster consonants maujood hain ya nahin."],
            "en_seeds": ["Play not pay the blue guitar.", "Black not back is the colour.", "Train not tain goes on the track."],
            "ur_seeds": ["Play nahin pay neeli gitar par.", "Black nahin back rang hai.", "Train nahin tain pagdandi par."],
            "phoneme_focus": "pl,bl,tr"
        },
        {
            "id": "finger_counting_cluster", "disorder": "cluster_reduction", "name_en": "Finger Counting", "name_ur": "Unglion Se Ginna",
            "category": "Awareness and Monitoring", "tier": 3, "interaction_type": "rhythm", "diagram_file": None,
            "cam_test_type": None, "scoring_config": {"expected_bpm": 80},
            "steps_en": ["Raise one finger for each consonant in the cluster as you say the word.", "For play: tap once for p then again for l then say the vowel.", "The kinesthetic cue reinforces that BOTH consonants are present.", "Tap the screen once per consonant while speaking.", "We score the regularity and count of your taps."],
            "steps_ur": ["Lafz bolte waqt cluster mein har consonant ke liye ek ungli uthao.", "play ke liye: p ke liye tap phir l ke liye phir vowel kaho.", "Yeh kinaesthetic cue yeh mazboot karta hai ke dono consonants hain.", "Bolte waqt har consonant ke liye screen tap karo.", "Hum aapke taps ki regularity aur tadaad score karenge."],
            "en_seeds": ["Play the blue plate game slowly.", "Bring the green tray from the kitchen.", "Stop the train at the crossing."],
            "ur_seeds": ["Neeli plate ka game dheere khelein.", "Rasoi se hari tray laao.", "Crossing par train rokein."],
            "phoneme_focus": "pl,bl,gr,tr,st"
        },
        {
            "id": "slow_motion_cluster", "disorder": "cluster_reduction", "name_en": "Slow Motion Blending", "name_ur": "Dheemi Raftar Milana",
            "category": "Fluency Shaping", "tier": 3, "interaction_type": "rate", "diagram_file": None,
            "cam_test_type": None, "scoring_config": {"target_spm": 80, "tolerance_pct": 0.30},
            "steps_en": ["Say each cluster word in super slow motion — as if video is at 10 percent speed.", "For play: p...l...ay. Stretch each phoneme individually.", "Then gradually speed up: super slow then slow then normal.", "Record the slow motion version. We measure that you are truly slowing down."],
            "steps_ur": ["Har cluster word ko super slow motion mein kaho — jaise video 10 percent speed par ho.", "play ke liye: p...l...ay. Har phoneme alag kheencho.", "Phir dhire dhire tezi laao: super slow phir slow phir normal.", "Slow motion version record karo. Hum measure karenge ke aap waqi slow ho rahe hain."],
            "en_seeds": ["Please place the plate slowly.", "Slowly blend the two sounds.", "Blend and say the word clearly."],
            "ur_seeds": ["Plate dheere dheere rakhein.", "Dheere dono awaazein milaao.", "Milaao aur lafz saaf kaho."],
            "phoneme_focus": "pl,bl,tr"
        },
        {
            "id": "sound_sandwich_cluster", "disorder": "cluster_reduction", "name_en": "Sound Sandwich", "name_ur": "Sound Sandwich",
            "category": "Practice and Drill", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "cluster_reduction", "scoring_config": {"target_accuracy": 80},
            "steps_en": ["Sound Sandwich: say correct form then error form then correct again.", "Example: play then pay then play again.", "The contrast draws attention to the presence vs absence of cluster consonant.", "Record all three. We score both play attempts for cluster integrity."],
            "steps_ur": ["Sound Sandwich: sahi form kaho phir error form phir dobara sahi.", "Misaal: play phir pay phir play dobara.", "Contrast cluster consonant ki maujoodgi aur ghairamaujoodgi par dhyan dilata hai.", "Teenonk record karo. Hum dono play attempts cluster integrity ke liye score karenge."],
            "en_seeds": ["Play then pay then play again.", "Black then back then black again.", "Train then tain then train again."],
            "ur_seeds": ["Play phir pay phir play dobara.", "Black phir back phir black dobara.", "Train phir tain phir train dobara."],
            "phoneme_focus": "pl,bl,tr"
        },
        {
            "id": "body_movement_cluster", "disorder": "cluster_reduction", "name_en": "Body Movement Mapping", "name_ur": "Jism Se Awaaz Map Karna",
            "category": "Awareness and Monitoring", "tier": 1, "interaction_type": "passive", "diagram_file": None,
            "cam_test_type": None, "scoring_config": None,
            "steps_en": ["Clap or tap your knee for each SOUND in a word not each syllable.", "stop has 4 sounds: s t o p — 4 taps.", "trip has 4 sounds — 4 taps not 1.", "One syllable does not mean one sound.", "This teaches the brain that clusters contain multiple sequential sounds."],
            "steps_ur": ["Lafz mein har AWAAZ ke liye taali bajao ya ghutna tap karo — syllable nahin.", "stop mein 4 awaazein hain: s t o p — 4 taps.", "trip mein 4 awaazein hain — 4 taps nahin 1.", "Ek syllable ek awaaz nahin hoti.", "Yeh brain ko sikhata hai ke clusters mein kai silsilewar awaazein hain."],
            "en_seeds": ["Tap once for every sound you hear.", "Stop has four separate sounds.", "Clap for each sound in trip."],
            "ur_seeds": ["Har awaaz ke liye ek baar tap karo.", "Stop mein chaar alag awaazein hain.", "Trip mein har awaaz ke liye taali bajao."],
            "phoneme_focus": "st,tr,pl"
        },
        {
            "id": "phonotactic_cluster", "disorder": "cluster_reduction", "name_en": "Phonotactic Therapy Game", "name_ur": "Awaaz Ka Khel",
            "category": "Awareness and Monitoring", "tier": 1, "interaction_type": "client_game", "diagram_file": None,
            "cam_test_type": None, "scoring_config": None,
            "steps_en": ["Game: 10 words will be read. Some have full clusters others are reduced.", "Tap CORRECT if the cluster is intact.", "Tap REDUCED if a consonant is missing.", "This builds awareness of what the full form should sound like."],
            "steps_ur": ["Game: 10 alfaaz parhe jaenge. Kuch mein poore clusters honge kuch mein reduced.", "CORRECT tap karo agar cluster intact hai.", "REDUCED tap karo agar koi consonant missing hai.", "Yeh shuoor deta hai ke poori form kaisi lagni chahiye."],
            "en_seeds": ["Is this play or pay — which is correct.", "Does the word have the full cluster.", "Tap correct or reduced for each word."],
            "ur_seeds": ["Kya yeh play hai ya pay — kaunsa sahi hai.", "Kya lafz mein poora cluster hai.", "Har lafz ke liye correct ya reduced tap karo."],
            "phoneme_focus": "pl,bl,tr,st"
        },
        {
            "id": "cycles_cluster", "disorder": "cluster_reduction", "name_en": "Cycles Approach", "name_ur": "Cycles Approach",
            "category": "Practice and Drill", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "cluster_reduction", "scoring_config": {"session_type": "cycles", "phoneme_rotation": ["st", "pl", "tr", "bl", "gr", "fr"], "cycle_duration_sec": 60},
            "steps_en": ["Cycles Approach rotates through cluster types in 60 second windows.", "Round 1: st clusters — stop step star stamp.", "Round 2: pl clusters — play place plan plastic.", "Round 3: tr clusters — tree train trip truck.", "Each round recorded and scored separately."],
            "steps_ur": ["Cycles Approach 60 second windows mein cluster types rotate karta hai.", "Round 1: st clusters — stop step star stamp.", "Round 2: pl clusters — play place plan plastic.", "Round 3: tr clusters — tree train trip truck.", "Har round alag record aur score hoga."],
            "en_seeds": ["Stop at the station for the train.", "Please place the plant on the tray.", "Try the green grapes from the tree."],
            "ur_seeds": ["Train ke liye station par ruko.", "Tray par poda rakhein.", "Darakht se hare angoor azmaao."],
            "phoneme_focus": "st,pl,tr,bl,gr,fr"
        },

        # --- EPENTHESIS ---
        {
            "id": "smooth_blending_epenthesis", "disorder": "epenthesis", "name_en": "Smooth Blending and Co-articulation", "name_ur": "Smooth Blending",
            "category": "Fluency Shaping", "tier": 3, "interaction_type": "phonation", "diagram_file": None,
            "cam_test_type": None, "scoring_config": {"max_gap_ms": 50},
            "steps_en": ["Epenthesis inserts a vowel: pulay for play. Fuse the consonants to fix it.", "Say play with ZERO gap between p and l. They should feel completely blended.", "Think of pl as a single combined unit not two separate sounds.", "Record the sentence. We analyze the silence gap between cluster consonants."],
            "steps_ur": ["Epenthesis ek vowel daalta hai: play ki jagah pulay. Consonants ko fuse karo.", "play kaho p aur l ke beech ZERO gap ke saath. Bilkul blend lagna chahiye.", "pl ko ek combined unit samjho nahin do alag awaazein.", "Jumla record karo. Hum cluster consonants ke darmiyan silence gap analyze karenge."],
            "en_seeds": ["Please place the blue plate on the tray.", "Blend the two sounds without pausing.", "Play the plain tune on the piano."],
            "ur_seeds": ["Tray par neeli plate rakhein.", "Dono awaazein bina rukay milaao.", "Piano par saada dhun bajao."],
            "phoneme_focus": "pl,bl,tr,fr"
        },
        {
            "id": "minimal_pairs_epenthesis", "disorder": "epenthesis", "name_en": "Minimal Pairs Contrast", "name_ur": "Milte Julte Lafz",
            "category": "Contrastive Therapy", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "epenthesis", "scoring_config": {"target_accuracy": 80},
            "steps_en": ["Epenthesis adds an extra vowel inside clusters: play becomes pulay.", "Listen to the correct and epenthetic versions of each pair.", "Say only the correct full cluster form.", "We score if you avoided inserting the extra vowel."],
            "steps_ur": ["Epenthesis clusters mein extra vowel daalta hai: play se pulay banta hai.", "Har pair ki sahi aur epenthetic versions sunein.", "Sirf sahi poora cluster form bolein.", "Hum score karenge ke aapne extra vowel daalny se bachaaya ya nahin."],
            "en_seeds": ["Say play not pulay every time.", "Say train not turain on the track.", "Say blue not bulue for the colour."],
            "ur_seeds": ["Har baar pulay nahin play kaho.", "Pagdandi par turain nahin train kaho.", "Rang ke liye bulue nahin blue kaho."],
            "phoneme_focus": "pl,tr,bl"
        },
        {
            "id": "whisper_to_voice_epenthesis", "disorder": "epenthesis", "name_en": "Whisper to Voice", "name_ur": "Sargoshi Se Awaaz",
            "category": "Practice and Drill", "tier": 3, "interaction_type": "voice_quality", "diagram_file": None,
            "cam_test_type": None, "scoring_config": {},
            "steps_en": ["Start each word in a WHISPER for the first half then transition to full voice.", "Say play: whisper the pl onset then voice the ay vowel fully.", "This trains smooth phonatory onset which prevents inserting an epenthetic vowel.", "Record. We detect if your energy rises smoothly — good — or jumps — epenthesis risk."],
            "steps_ur": ["Har lafz pehle aadhe SARGOSHI mein shuru karo phir poori awaaz mein aao.", "play kaho: pl onset sargoshi mein phir ay vowel poori awaaz mein.", "Yeh smooth phonatory onset train karta hai jo epenthetic vowel dalne se rokta hai.", "Record karo. Hum dekhenge energy smoothly barhti hai ya uchhalti hai."],
            "en_seeds": ["Whisper play then say it fully.", "Start soft then grow louder each word.", "Feel your voice rise from a whisper."],
            "ur_seeds": ["play pehle sargoshi mein phir poora kaho.", "Dheere shuru karo phir har lafz louder.", "Awaaz ko sargoshi se uthte mehsoos karo."],
            "phoneme_focus": "pl,tr,bl,fr"
        },
        {
            "id": "self_monitoring_epenthesis", "disorder": "epenthesis", "name_en": "Recording and Self Monitoring", "name_ur": "Khud Ko Sunna",
            "category": "Awareness and Monitoring", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "epenthesis", "scoring_config": {"target_accuracy": 80},
            "steps_en": ["Record yourself saying each sentence.", "Listen back at slowed down playback speed shown on screen.", "The word level analysis will highlight any inserted vowels in cluster words.", "Compare what you intended to say versus what the system detected."],
            "steps_ur": ["Khud ko har jumla bolte hue record karo.", "Screen par dikhaayi slow playback speed par sunein.", "Word level analysis cluster words mein daalay gaye vowels highlight karega.", "Aap ne jo bolne ka irada kiya tha aur system ne jo detect kiya unka moazna karo."],
            "en_seeds": ["Listen back to your own recording carefully.", "Did you say play or pulay in that word.", "Check each cluster word for extra vowels."],
            "ur_seeds": ["Apni recording ghoor se sunein.", "Aapne play kaha ya pulay us lafz mein.", "Har cluster word mein extra vowels check karo."],
            "phoneme_focus": "pl,tr,bl,fr"
        },
        {
            "id": "speed_drill_epenthesis", "disorder": "epenthesis", "name_en": "Speed Drill", "name_ur": "Speed Drill",
            "category": "Practice and Drill", "tier": 2, "interaction_type": "cam_scored", "diagram_file": None,
            "cam_test_type": "epenthesis", "scoring_config": {"target_accuracy": 85},
            "steps_en": ["Say each cluster word as FAST as you can without inserting a vowel.", "Speed forces the brain to blend consonants naturally — no time to insert.", "Round 1: slow. Round 2: medium. Round 3: as fast as possible.", "Record Round 3. We score cluster integrity at speed."],
            "steps_ur": ["Har cluster word ko bina vowel daale jitni tezi se ho sake kaho.", "Speed brain ko consonants naturally blend karne par majboor karti hai.", "Round 1: slow. Round 2: medium. Round 3: jitni tezi ho sake.", "Round 3 record karo. Hum speed mein cluster integrity score karenge."],
            "en_seeds": ["Play the blue plate game fast.", "Bring the green tray quickly now.", "Train stops at the crossing fast."],
            "ur_seeds": ["Neeli plate game tezi se khelein.", "Jaldi harri tray laao.", "Crossing par train jaldi rokein."],
            "phoneme_focus": "pl,bl,tr,gr"
        },
        {
            "id": "mirror_articulation_epenthesis", "disorder": "epenthesis", "name_en": "Mirror Articulation", "name_ur": "Aaine Mein Dekhna",
            "category": "Awareness and Monitoring", "tier": 1, "interaction_type": "passive", "diagram_file": None,
            "cam_test_type": None, "scoring_config": None,
            "steps_en": ["Watch yourself in a mirror as you say cluster words.", "Look for your mouth opening for a vowel BEFORE the second consonant.", "That extra mouth opening is epenthesis.", "Correct: pl — lips together then immediately open for vowel with no extra movement.", "Practice 10 times per word until you see no extra mouth opening."],
            "steps_ur": ["Cluster words bolte waqt aaine mein khud ko dekho.", "Muh ka doosre consonant se PEHLE vowel ke liye kholna dekho.", "Woh extra muh kholna epenthesis hai.", "Sahi: pl — hont saath phir fauran vowel ke liye khulein koi extra movement nahin.", "Har lafz 10 baar practice karo jab tak extra muh kholna na dikhe."],
            "en_seeds": ["Watch for extra mouth opening in clusters.", "Keep lips together until the vowel.", "Check your mouth in the mirror each time."],
            "ur_seeds": ["Clusters mein extra muh kholna dekho.", "Vowel tak hont saath rakhein.", "Har baar aaine mein muh check karo."],
            "phoneme_focus": "pl,bl,tr"
        },
        {
            "id": "finger_pinch_epenthesis", "disorder": "epenthesis", "name_en": "Finger Pinch Cue", "name_ur": "Ungli Dabana",
            "category": "Awareness and Monitoring", "tier": 1, "interaction_type": "passive", "diagram_file": None,
            "cam_test_type": None, "scoring_config": None,
            "steps_en": ["Pinch your fingers together as you begin each consonant cluster.", "Maintain the pinch through BOTH consonants — release only on the vowel.", "For play: pinch on p stay pinched through l release on ay.", "The pinch physically represents squeezing the two consonants together."],
            "steps_ur": ["Har consonant cluster shuru karte waqt ungliyan pinch karein.", "DONO consonants tak pinch barkarar rakhein — sirf vowel par chhodein.", "play ke liye: p par pinch l tak rahe ay par chhodein.", "Pinch physically dono consonants ko saath dabaane ko represent karta hai."],
            "en_seeds": ["Pinch your fingers for the cluster.", "Hold the pinch through both consonants.", "Release only when the vowel arrives."],
            "ur_seeds": ["Cluster ke liye ungliyan pinch karein.", "Dono consonants mein pinch rakho.", "Sirf vowel aane par chhodin."],
            "phoneme_focus": "pl,bl,tr"
        }
    ]

    # 3. Seed Database
    print("Seeding database...")
    
    for tech in techniques:
        # Insert Technique
        cursor.execute('''
            INSERT OR IGNORE INTO techniques (
                id, disorder, name_en, name_ur, category, tier, interaction_type, 
                youtube_id_en, youtube_id_ur, diagram_file, steps_en, steps_ur, 
                cam_test_type, scoring_config
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            tech["id"], tech["disorder"], tech["name_en"], tech["name_ur"], 
            tech["category"], tech["tier"], tech["interaction_type"], 
            tech.get("youtube_id_en"), tech.get("youtube_id_ur"), tech["diagram_file"], 
            json.dumps(tech["steps_en"]), json.dumps(tech["steps_ur"]), 
            tech.get("cam_test_type"), 
            json.dumps(tech["scoring_config"]) if tech["scoring_config"] else None
        ))

        # Insert English Seeds
        for sentence in tech["en_seeds"]:
            cursor.execute('''
                INSERT OR IGNORE INTO technique_sentences (
                    technique_id, language, difficulty, sentence, phoneme_focus, word_count
                ) VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                tech["id"], 'english', 1, sentence, tech["phoneme_focus"], len(sentence.split())
            ))

        # Insert Urdu Seeds
        for sentence in tech["ur_seeds"]:
            cursor.execute('''
                INSERT OR IGNORE INTO technique_sentences (
                    technique_id, language, difficulty, sentence, phoneme_focus, word_count
                ) VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                tech["id"], 'urdu', 1, sentence, tech["phoneme_focus"], len(sentence.split())
            ))

    conn.commit()
    conn.close()
    print('techniques.db seeded successfully.')

if __name__ == '__main__':
    seed_db()

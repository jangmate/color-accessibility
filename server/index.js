import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';
import { config } from 'dotenv';
import helmet from 'helmet';
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_color_accessibility';

// 데이터베이스 초기화
const db = new sqlite3.Database(path.join(__dirname, 'history.db'), (err) => {
  if (err) {
    console.error('SQLite 연결 오류:', err.message);
  } else {
    console.log('SQLite 데이터베이스 연결 성공');
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        filename TEXT NOT NULL,
        imageData TEXT NOT NULL,
        analysis TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `, () => {
      // 만약 기존 history 테이블이 있다면 user_id 컬럼 추가 시도
      db.run(`ALTER TABLE history ADD COLUMN user_id INTEGER;`, (err) => {
        // 이미 컬럼이 존재하면 무시됨
      });
    });
  }
});

// 프로미스 기반 DB 함수
const runDb = (sql, params) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err); else resolve(this);
  });
});

const getDb = (sql, params) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err); else resolve(rows);
  });
});

if (!process.env.GITHUB_TOKEN) {
  console.error('오류: GITHUB_TOKEN 환경 변수가 설정되지 않았습니다. .env 파일을 확인해주세요.');
  process.exit(1);
}

const SUPPORTED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const MEDIA_TYPE_MAP = {
  'image/jpg': 'image/jpeg',
};

// 색상 대비 계산 유틸리티 (서버 측 검증용)
function hexToRgb(hex) {
  if (!hex) return null;
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return null;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return { r, g, b };
}

function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }) {
  const rLin = srgbToLinear(r);
  const gLin = srgbToLinear(g);
  const bLin = srgbToLinear(b);
  return { L: 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin, rLin, gLin, bLin };
}

function computeContrastRatio(fgHex, bgHex) {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) return null;
  const fgLum = relativeLuminance(fg);
  const bgLum = relativeLuminance(bg);
  const L1 = Math.max(fgLum.L, bgLum.L);
  const L2 = Math.min(fgLum.L, bgLum.L);
  const ratio = (L1 + 0.05) / (L2 + 0.05);
  return {
    ratio: Math.round(ratio * 10) / 10,
    foreground: { r: fg.r, g: fg.g, b: fg.b, r_lin: round(fgLum.rLin, 6), g_lin: round(fgLum.gLin, 6), b_lin: round(fgLum.bLin, 6), L: round(fgLum.L, 6) },
    background: { r: bg.r, g: bg.g, b: bg.b, r_lin: round(bgLum.rLin, 6), g_lin: round(bgLum.gLin, 6), b_lin: round(bgLum.bLin, 6), L: round(bgLum.L, 6) },
  };
}

function round(v, digits = 3) {
  if (typeof v !== 'number') return v;
  const m = Math.pow(10, digits);
  return Math.round(v * m) / m;
}

// 간단한 메모리 기반 Rate Limiter (프로덕션에서는 Redis 사용 권장)
const requestLimiter = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1분
const RATE_LIMIT_MAX_REQUESTS = 10; // 1분에 최대 10개 요청

function checkRateLimit(clientIp) {
  const now = Date.now();
  if (!requestLimiter.has(clientIp)) {
    requestLimiter.set(clientIp, []);
  }

  const requests = requestLimiter.get(clientIp);
  const recentRequests = requests.filter(time => now - time < RATE_LIMIT_WINDOW);

  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  recentRequests.push(now);
  requestLimiter.set(clientIp, recentRequests);
  return true;
}

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 10MB → 5MB로 축소
  fileFilter: (_req, file, cb) => {
    // 파일 크기 검증
    if (file.size < 10 * 1024) { // 최소 10KB
      cb(new Error('이미지가 너무 작습니다. 최소 10KB 이상이어야 합니다.'));
      return;
    }

    const normalized = MEDIA_TYPE_MAP[file.mimetype] ?? file.mimetype;
    if (SUPPORTED_MEDIA_TYPES.has(normalized)) cb(null, true);
    else cb(new Error('지원하지 않는 이미지 형식입니다.'));
  },
});

// CORS 설정 - 보안 강화
app.use(cors({
  origin: true,
  credentials: true,
  maxAge: 86400, // 24시간
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Helmet 보안 헤더 추가
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https:", "http:"],
    },
  },
}));

app.use(express.json({ limit: '1mb' })); // JSON 페이로드 크기 제한
app.use(cookieParser());

// 인증 미들웨어
const authenticate = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    req.user = null;
    next();
  }
};

const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  next();
};

app.use(authenticate);

// 회원가입
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });

  try {
    const existing = await getDb('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) return res.status(400).json({ error: '이미 존재하는 아이디입니다.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await runDb('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
    res.json({ message: '회원가입 성공', userId: result.lastID });
  } catch (error) {
    console.error('회원가입 오류:', error);
    res.status(500).json({ error: '회원가입 중 오류가 발생했습니다.' });
  }
});

// 로그인
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });

  try {
    const users = await getDb('SELECT * FROM users WHERE username = ?', [username]);
    const user = users[0];
    if (!user) return res.status(400).json({ error: '아이디 또는 비밀번호가 일치하지 않습니다.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: '아이디 또는 비밀번호가 일치하지 않습니다.' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 86400000 });
    res.json({ message: '로그인 성공', user: { id: user.id, username: user.username } });
  } catch (error) {
    console.error('로그인 오류:', error);
    res.status(500).json({ error: '로그인 중 오류가 발생했습니다.' });
  }
});

// 로그아웃
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: '로그아웃 ���' });
});

// 내 정보 조회
app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: req.user });
});

// GitHub Models API 클라이언트 초기화
const client = new OpenAI({
  apiKey: process.env.GITHUB_TOKEN,
  baseURL: 'https://models.inference.ai.azure.com',
  defaultHeaders: {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'github-token': process.env.GITHUB_TOKEN,
  },
});

// 최적화된 프롬프트 (정밀한 명도대비 계산)
// 오로지 텍스트와 주변 배경의 명도대비만 분석, 로고/아이콘/단순 UI컴포넌트는 무시
const ANALYZE_PROMPT = "중요: 이미지를 분석할 때 오로지 텍스트(글자)와 그 주변 배경의 색상만을 극도로 정밀하게 추출하세요. 로고, 아이콘, 장식용 그래픽은 무시하십시오.\n\n" +
  "가장 중요한 점: 텍스트의 전경색(글자색)과 글자 바로 뒤의 배경색을 정확한 6자리 HEX 코드(예: #3FA9F5, #FFFFFF)로 추출해야 합니다. 시각적으로 대충 비슷해 보이는 색(예: 파란색을 무조건 #0000FF로 적는 등)을 임의로 적지 말고,  이미지에 픽셀 단위로 렌더링된 실제 색상값을 최대한 정확히 반영하세요.\n\n" +
  "반드시 WCAG의 공식 명도대비 계산식을 사용하여 수치적으로 계산해야 합니다. 모델 응답은 다음 절차를 정확히 따르십시오:\n" +
  "1) 정확하게 추출한 전경색(foreground)과 배경색(background)을 6자리 HEX(예: #RRGGBB)로 표기합니다.\n" +
  "2) HEX의 R,G,B 값을 0..255로 읽어 각각 s = component / 255 로 정규화합니다.\n" +
  "3) 각 sRGB 성분을 linearize합니다:\n" +
  "   if s <= 0.03928 then lin = s / 12.92 else lin = ((s + 0.055) / 1.055) ** 2.4\n" +
  "4) 상대휘도(relative luminance) L을 계산합니다:\n" +
  "   L = 0.2126 * R_lin + 0.7152 * G_lin + 0.0722 * B_lin\n" +
  "5) 두 색상의 상대휘도 L1, L2를 결정(큰 값을 L1, 작은 값을 L2로 사용)하고,\n" +
  "   contrast ratio = (L1 + 0.05) / (L2 + 0.05)\n" +
  "6) contrast ratio는 소수점 한 자리까지 반올림하여 'contrastRatio'에 넣으세요 (예: 2.6, 9.3).\n" +
  "7) [필수] 각 텍스트 요소가 이미지에서 차지하는 위치와 크기를 'boundingBox' 속성에 반드시 배열로 입력하세요. 형식은 [x, y, width, height]이며, 단위는 전체 이미지 크기 대비 퍼센트(0-100)입니다. (예: 왼쪽 최상단에서 너비 20%, 높이 10%인 경우 [0, 0, 20, 10])\n\n" +
  "응답 형식(정확히 이 JSON만 반환):\n" +
  "{\n  \"summary\": \"한국어 평가\",\n  \"overallPass\": boolean,\n  \"elements\": [\n    {\n      \"id\": number,\n      \"description\": \"텍스트 내용 및 설명 (예: 헤드라인, 본문 등)\",\n      \"type\": \"normal_text\" | \"large_text\" | \"ui_component\",\n      \"foregroundColor\": \"#HEX\",\n      \"backgroundColor\": \"#HEX\",\n      \"contrastRatio\": number,\n      \"calculation\": {\n        \"foreground\": { \"r\": number, \"g\": number, \"b\": number, \"r_lin\": number, \"g_lin\": number, \"b_lin\": number, \"L\": number },\n        \"background\": { \"r\": number, \"g\": number, \"b\": number, \"r_lin\": number, \"g_lin\": number, \"b_lin\": number, \"L\": number }\n      },\n      \"wcagAA\": boolean,\n      \"wcagAAA\": boolean,\n      \"location\": \"위치\",\n      \"boundingBox\": [number, number, number, number]\n    }\n  ]\n}\n" +
  "추가 지침:\n" +
  "- [매우 중요] 반드시 모든 element 객체 내부에 'boundingBox' 배열(4개의 숫자)을 포함해야 합니다.\n" +
  "- [매우 중요] 'type'의 분류 기준: 두껍고 큰 제목(약 18pt 이상, 또는 14pt 볼드 상당)은 'large_text', 버튼이나 입력창 등 UI 컴포넌트의 텍스트는 'ui_component', 그 외의 작은 본문 텍스트는 'normal_text'로 분류하세요.\n" +
  "- 텍스트 색상(foregroundColor)과 배경색(backgroundColor) 추출의 정확도가 생명입니다. 대략적인 색상 이름을 기반으로 HEX를 유추하지 마세요.\n" +
  "- 위의 수학적 절차로 정확하게 계산하세요.\n" +
  "- 응답에는 오직 JSON만 포함되어야 하며, 부가 설명 텍스트는 포함하지 마세요.";

// Rate Limiter 미들웨어
app.use((req, res, next) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
  }
  next();
});

app.post('/api/analyze', upload.array('images', 5), async (req, res) => {
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: '이미지를 업로드해주세요.' });
  }

  // 안전한 로깅 (민감한 정보 제외)
  console.log(`[${new Date().toISOString()}] 분석 요청: ${files.length}개 이미지`);

  try {
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff'); // XSS 방지

    // 순차 처리로 토큰 사용량 제어 (병렬 처리는 비용 증가)
    const results = await Promise.all(
      files.map(async (file) => {
        try {
          const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');

          // 1) Sharp를 이용한 이미지 전처리 (원본 색상 보존: normalize 제거, 손실 압축 제거 후 png 사용)
          const processedBuffer = await sharp(file.buffer)
            .flatten({ background: { r: 255, g: 255, b: 255 } }) // 투명 배경을 흰색으로 변경
            .png()
            .toBuffer();

          const base64Image = processedBuffer.toString('base64');
          const mediaType = 'image/png';

          console.log(`[${new Date().toISOString()}] 분석 시작 (전처리 완료): ${originalname.slice(0, 50)}`);

          const response = await client.chat.completions.create({
            model: 'gpt-4o',
            max_tokens: 2048,
            temperature: 0.1, // 환각 오류 최소화 및 일관성 확보
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${mediaType};base64,${base64Image}`,
                      detail: 'high' // 고해상도 타일링 분석 강제
                    },
                  },
                  { type: 'text', text: ANALYZE_PROMPT },
                ],
              },
            ],
          });

          const content = response.choices[0]?.message?.content;
          if (!content) {
            throw new Error('응답 형식 오류');
          }

          let analysis;
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            analysis = JSON.parse(jsonMatch ? jsonMatch[0] : content);

            // 응답 검증
            if (!analysis.summary || analysis.overallPass === undefined || !Array.isArray(analysis.elements)) {
              throw new Error('응답 구조 오류');
            }

            // 서버 측에서 계산으로 검증 및 보정
            try {
              analysis.elements = analysis.elements.map((el, idx) => {
                const fg = el.foregroundColor || el.fg || null;
                const bg = el.backgroundColor || el.bg || null;
                if (fg && bg) {
                  const comp = computeContrastRatio(String(fg).trim(), String(bg).trim());
                  if (comp) {
                    el.contrastRatio = comp.ratio;
                    el.calculation = comp;
                    const is14pxOrMore = el.fontSize !== undefined ? el.fontSize >= 14 : false;
                    const isLargeOrUI = is14pxOrMore || el.type === 'large_text' || el.type === 'ui_component';
                    el.wcagAA = isLargeOrUI ? comp.ratio >= 3.0 : comp.ratio >= 4.5;
                    el.wcagAAA = isLargeOrUI ? comp.ratio >= 4.5 : comp.ratio >= 7.0;
                  }
                } else {
                  el.calculation = null;
                }
                el.id = el.id ?? idx + 1;
                return el;
              });

              analysis.overallPass = analysis.elements.every(e => e.wcagAA === true);
            } catch (verifyError) {
              console.warn('서버 측 계산 중 오류:', verifyError);
            }
          } catch (parseError) {
            console.warn(`파싱 실패: ${originalname.slice(0, 50)}`);
            throw new Error('분석 결과 처리 오류');
          }

          console.log(`[${new Date().toISOString()}] 분석 완료: ${originalname.slice(0, 50)}`);
          return {
            filename: originalname.slice(0, 255), // 파일명 길이 제한
            imageData: `data:${mediaType};base64,${base64Image}`,
            analysis,
          };
        } catch (error) {
          const errorName = file ? Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 50) : 'unknown';
          console.error(`❌ 이미지 처리 실패: ${errorName}`);
          console.error('에러 상세:', error);
          if (error instanceof Error) {
            console.error('- 메시지:', error.message);
            console.error('- 스택:', error.stack);
          }
          return null; // 에러 발생한 항목은 null 반환
        }
      })
    );

    const validResults = results.filter(r => r !== null);

    if (validResults.length === 0) {
      console.error('❌ 모든 이미지 분석 실패');
      return res.status(500).json({ error: '분석에 실패했습니다. 다시 시도해주세요.' });
    }

    console.log(`✅ 분석 완료: ${validResults.length}개 이미지 성공`);

    // DB에 검수 결과 저장
    for (const resItem of validResults) {
      if (req.user) {
        try {
          await runDb(
            'INSERT INTO history (user_id, filename, imageData, analysis) VALUES (?, ?, ?, ?)',
            [req.user.id, resItem.filename, resItem.imageData, JSON.stringify(resItem.analysis)]
          );
        } catch (dbErr) {
          console.error('DB 저장 실패:', dbErr);
        }
      }
    }

    res.json({ results: validResults, count: validResults.length });
  } catch (error) {
    console.error('[FATAL ERROR]', error);
    if (error instanceof Error) {
      console.error('- 메시지:', error.message);
      console.error('- 스택:', error.stack);
    }
    // 에러 메시지에 민감한 정보 노출 방지
    const statusCode = error?.status === 429 ? 429 : 500;
    res.status(statusCode).json({ error: '서비스 처리 중 오류가 발생했습니다.' });
  }
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 히스토리 조회 API
app.get('/api/history', requireAuth, async (req, res) => {
  try {
    const search = req.query.search || '';
    const limit = parseInt(req.query.limit, 10) || 50;

    let sql = 'SELECT id, filename, imageData, analysis, created_at FROM history WHERE user_id = ?';
    const params = [req.user.id];

    if (search) {
      sql += ' AND (filename LIKE ? OR analysis LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term);
    }

    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const rows = await getDb(sql, params);
    const parsedRows = rows.map(row => ({
      id: row.id,
      filename: row.filename,
      imageData: row.imageData,
      analysis: JSON.parse(row.analysis),
      created_at: row.created_at
    }));

    res.json({ history: parsedRows });
  } catch (error) {
    console.error('히스토리 조회 오류:', error);
    res.status(500).json({ error: '히스토리 조회 중 오류가 발생했습니다.' });
  }
});

// 정적 파일 서빙 (프로덕션 환경: 프론트엔드 빌드 파일)
const buildPath = path.join(__dirname, '../build');
app.use('/color-accessibility', express.static(buildPath)); // vite.config.ts의 base 적용
app.use(express.static(buildPath)); // 루트 접근용

// 그 외 모든 경로는 프론트엔드의 index.html을 반환하도록 설정 (SPA 라우팅 지원)
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});
// 비동기 예외 및 종료 원인 추적
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] 서버 실행: http://localhost:${PORT}`);
});

console.log('서버 코드 끝까지 실행됨');

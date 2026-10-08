/*
  FILE 3/3: script.js  =  "bộ não" của trang: đọc file, chia đoạn, gọi Gemini, lưu tiến độ.
  Các phần được đánh số để bạn dễ tìm.
*/

// Hàm tắt: $("key") nghĩa là "lấy phần tử HTML có id là key"
const $ = id => document.getElementById(id);

// ---------- 1. LỜI DẶN CHO AI (sửa ở đây để đổi văn phong dịch) ----------
const SYSTEM = [
  "Bạn là dịch giả truyện tiếng Trung sang tiếng Việt chuyên nghiệp.",
  "Dịch mượt mà, tự nhiên như một bộ truyện dịch đã xuất bản: câu văn thuần Việt, đúng ngữ cảnh, giữ giọng điệu và cảm xúc của nguyên tác, không dịch word-by-word.",
  "Giữ nguyên cấu trúc đoạn và lời thoại: mỗi đoạn/dòng của bản gốc ứng với một đoạn/dòng trong bản dịch, giữ nguyên các dòng trống.",
  "Tên người, tên địa danh, môn phái, chiêu thức, danh xưng cổ trang thì phiên âm Hán Việt (ví dụ 林默 = Lâm Mặc). Nếu có bảng thuật ngữ thì bắt buộc dùng theo bảng.",
  "Chỉ trả về bản dịch, không thêm lời dẫn, ghi chú, giải thích hay lời xin lỗi. Không bỏ sót hay lược bớt nội dung."
].join("\n");

// ---------- 2. CÁC BIẾN LƯU TRẠNG THÁI ----------
let chunks  = [];    // danh sách các đoạn tiếng Trung đã chia
let results = [];    // bản dịch của từng đoạn (null = chưa dịch)
let errors  = [];    // lỗi của từng đoạn (nếu có)
let fileKey = "";    // tên dùng để lưu tiến độ của file đang mở
let running = false; // đang dịch hay không
let stopFlag = false;// true khi bạn bấm "Tạm dừng"
let current = -1;    // số thứ tự đoạn đang dịch

// ---------- 3. LƯU CÀI ĐẶT TRONG TRÌNH DUYỆT (localStorage) ----------
// try/catch để không bị lỗi nếu trình duyệt chặn lưu trữ
function lsGet(k){ try{ return localStorage.getItem(k) }catch(e){ return null } }
function lsSet(k,v){ try{ localStorage.setItem(k,v) }catch(e){} }

// Khi mở trang: điền lại những gì đã lưu lần trước
$("key").value   = lsGet("dt_key")   || "";
$("model").value = lsGet("dt_model") || "gemini-flash-latest";
$("gloss").value = lsGet("dt_gloss") || "";
$("size").value  = lsGet("dt_size")  || 2000;
$("gap").value   = lsGet("dt_gap")   || 5;
// Mỗi khi bạn sửa một ô thì lưu lại ngay
["key","model","gloss","size","gap"].forEach(id =>
  $(id).addEventListener("change", () => lsSet("dt_" + id, $(id).value)));

// ---------- 4. ĐỌC FILE VÀ CHIA ĐOẠN ----------
// Đọc chữ từ file: thử UTF-8 trước, nếu lỗi thì thử GB18030 (mã hay gặp ở truyện Trung)
function decode(buf){
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf) }
  catch(e){ return new TextDecoder("gb18030").decode(buf) }
}

// Chia truyện thành các đoạn dài tối đa "max" ký tự, cắt ở cuối dòng hoặc cuối câu
function splitChunks(text, max){
  text = text.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const lines = [];
  for (const raw of text.split("\n")){
    let line = raw;
    // Dòng quá dài thì cắt ở dấu chấm 。 (hoặc dấu phẩy ，) gần nhất
    while (line.length > max){
      let cut = line.lastIndexOf("。", max);
      if (cut < max * 0.4) cut = line.lastIndexOf("，", max);
      if (cut < max * 0.4) cut = max - 1;
      lines.push(line.slice(0, cut + 1));
      line = line.slice(cut + 1);
    }
    lines.push(line);
  }
  // Gom các dòng lại thành đoạn, đủ độ dài thì sang đoạn mới
  const out = []; let buf = "";
  for (const l of lines){
    if (buf && (buf.length + l.length + 1) > max){ out.push(buf.replace(/^\n+|\n+$/g, "")); buf = ""; }
    buf += (buf ? "\n" : "") + l;
  }
  if (buf.trim()) out.push(buf.replace(/^\n+|\n+$/g, ""));
  return out.filter(c => c.trim());
}

// Chạy khi bạn chọn hoặc kéo thả file
async function loadFile(f){
  if (!f) return;
  const text = decode(await f.arrayBuffer());
  const max = Math.max(500, parseInt($("size").value) || 2000);
  chunks = splitChunks(text, max);

  // Tạo "chìa khóa" riêng cho file này để lưu và khôi phục tiến độ
  fileKey = "dt_prog_" + f.name + "_" + f.size + "_" + max;
  let saved = null;
  try { saved = JSON.parse(lsGet(fileKey) || "null") } catch(e){}
  results = chunks.map((_, i) => saved && saved[i] ? saved[i] : null);
  errors  = chunks.map(() => null);

  // Hiện tên file và số đoạn trong khung kéo thả
  $("dropText").innerHTML = "<strong></strong>";
  $("dropText").firstChild.textContent = f.name;
  $("dropText").insertAdjacentText("beforeend", chunks.length + " đoạn · " + text.length.toLocaleString("vi-VN") + " ký tự");

  render();
  const done = results.filter(Boolean).length;
  setStatus(done ? "Đã khôi phục " + done + "/" + chunks.length + " đoạn từ lần dịch trước." : "Sẵn sàng dịch " + chunks.length + " đoạn.");
  $("start").disabled = false;
  $("start").textContent = done ? "Dịch tiếp" : "Bắt đầu dịch";
  $("dl").disabled = !done;
  updateBar();
}
$("file").addEventListener("change", e => loadFile(e.target.files[0]));

// Kéo thả file vào khung
const drop = $("drop");
drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); $("file").click(); } });
["dragover","dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave","drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => loadFile(e.dataTransfer.files[0]));

// ---------- 5. HIỂN THỊ LÊN MÀN HÌNH ----------
// Ghi dòng thông báo (isErr = true thì hiện màu đỏ)
function setStatus(msg, isErr){ const s = $("status"); s.textContent = msg; s.className = "status" + (isErr ? " err" : ""); }

// Cập nhật thanh tiến độ
function updateBar(){
  const done = results.filter(Boolean).length;
  $("barFill").style.width = chunks.length ? (done / chunks.length * 100) + "%" : "0";
}

// Vẽ lại ô bản dịch của đoạn số i (đã dịch / lỗi / đang dịch / chưa dịch)
function paintTr(i){
  const el = document.getElementById("tr" + i); if (!el) return;
  el.className = "tr";
  if (results[i]) el.textContent = results[i];
  else if (errors[i]){ el.className = "tr fail"; el.textContent = "Lỗi: " + errors[i]; }
  else { el.className = "tr wait"; el.textContent = i === current ? "Đang dịch…" : "Chưa dịch"; }
  if (i === current) el.classList.add("cur");
}

// Vẽ toàn bộ danh sách đoạn (mỗi đoạn là một hàng gồm bản gốc + bản dịch)
function render(){
  const list = $("list"); list.textContent = "";
  $("cols").hidden = !chunks.length;
  const frag = document.createDocumentFragment();
  chunks.forEach((c, i) => {
    const row = document.createElement("div"); row.className = "chunk";
    const s = document.createElement("div"); s.className = "src"; s.textContent = c;
    const t = document.createElement("div"); t.id = "tr" + i;
    row.append(s, t); frag.appendChild(row);
  });
  list.appendChild(frag);
  chunks.forEach((_, i) => paintTr(i));
}

// ---------- 6. GỌI GEMINI ĐỂ DỊCH ----------
const sleep = ms => new Promise(r => setTimeout(r, ms)); // chờ ms mili-giây

// Chờ "sec" giây, vừa chờ vừa đếm ngược, bấm Tạm dừng là thoát
async function waitInterruptible(sec, msg){
  for (let s = sec; s > 0 && !stopFlag; s--){ setStatus(msg + " (" + s + "s)"); await sleep(1000); }
}

// Ghép nội dung gửi cho AI: bảng thuật ngữ + đuôi đoạn trước + đoạn cần dịch
function buildPrompt(i){
  const parts = [];
  const gloss = $("gloss").value.trim();
  if (gloss) parts.push("BẢNG THUẬT NGỮ (bắt buộc dùng):\n" + gloss);
  const prev = i > 0 && results[i-1] ? results[i-1].slice(-400) : "";
  if (prev) parts.push("NGỮ CẢNH (cuối đoạn trước đã dịch, chỉ để nối mạch văn, KHÔNG dịch lại):\n" + prev);
  parts.push("DỊCH ĐOẠN SAU SANG TIẾNG VIỆT:\n" + chunks[i]);
  return parts.join("\n\n---\n\n");
}

// Gửi đoạn số i cho Gemini và nhận bản dịch về
async function callGemini(i){
  const key = $("key").value.trim();
  const model = $("model").value.trim() || "gemini-flash-latest";
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
  // Tắt bộ lọc an toàn để truyện có cảnh đánh nhau không bị chặn nhầm
  const cats = ["HARM_CATEGORY_HARASSMENT","HARM_CATEGORY_HATE_SPEECH","HARM_CATEGORY_SEXUALLY_EXPLICIT","HARM_CATEGORY_DANGEROUS_CONTENT"];
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: buildPrompt(i) }] }],
    // Không đặt "temperature": Gemini 3 chạy tốt nhất ở mức mặc định của Google
    safetySettings: cats.map(c => ({ category: c, threshold: "BLOCK_NONE" }))
  };

  // Thử tối đa 6 lần nếu bị giới hạn lượt gọi (429) hoặc server bận (500, 503)
  for (let attempt = 0; attempt < 6; attempt++){
    if (stopFlag) throw new Error("Đã tạm dừng");
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body)
      });
    } catch (e) {                       // mất mạng
      await waitInterruptible(10, "Mất kết nối, thử lại");
      continue;
    }
    if (res.status === 429 || res.status === 500 || res.status === 503){
      await waitInterruptible(15 * (attempt + 1), "Gemini đang giới hạn/bận, chờ rồi thử lại (đoạn " + (i+1) + ")");
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || ("HTTP " + res.status));

    // Lấy chữ dịch ra khỏi kết quả Gemini trả về
    const cand = data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || "").join("") : "";
    if (!text.trim()){
      const why = (cand && cand.finishReason) || (data.promptFeedback && data.promptFeedback.blockReason) || "rỗng";
      throw new Error("Gemini không trả về nội dung (" + why + ")");
    }
    return text.trim();
  }
  throw new Error("Hết lượt thử, có thể đã chạm hạn mức free. Hãy thử lại sau.");
}

// Lưu tiến độ vào trình duyệt để lần sau dịch tiếp
function saveProgress(){ lsSet(fileKey, JSON.stringify(results)); }

// ---------- 7. VÒNG LẶP DỊCH TỪNG ĐOẠN ----------
async function run(){
  if (running) return;
  if (!$("key").value.trim()){ setStatus("Hãy dán API key Gemini trước.", true); $("key").focus(); return; }
  lsSet("dt_key", $("key").value); lsSet("dt_model", $("model").value);

  running = true; stopFlag = false;
  $("start").disabled = true; $("stop").disabled = false; $("file").disabled = true;
  const gap = Math.max(0, parseFloat($("gap").value) || 0) * 1000;
  let failed = 0;

  for (let i = 0; i < chunks.length && !stopFlag; i++){
    if (results[i]) continue;           // đoạn đã dịch rồi thì bỏ qua
    const prevCur = current; current = i; errors[i] = null;
    paintTr(i); if (prevCur >= 0) paintTr(prevCur);
    document.getElementById("tr" + i).scrollIntoView({ block: "center", behavior: "smooth" });
    setStatus("Đang dịch đoạn " + (i+1) + "/" + chunks.length + "…");
    try {
      results[i] = await callGemini(i);
      saveProgress();
    } catch (e) {
      if (stopFlag) break;
      errors[i] = e.message; failed++;
      // Lỗi key sai hoặc không có quyền thì dừng hẳn, đừng thử các đoạn sau
      if (/API key|API_KEY|PERMISSION|403|400/i.test(e.message)){ current = -1; paintTr(i); setStatus("Lỗi: " + e.message, true); break; }
    }
    current = -1; paintTr(i); updateBar();
    $("dl").disabled = !results.some(Boolean);
    if (!stopFlag && gap && i < chunks.length - 1) await sleep(gap);  // nghỉ giữa các đoạn
  }

  // Kết thúc: trả các nút về trạng thái bình thường và báo kết quả
  current = -1; chunks.forEach((_, i) => paintTr(i));
  running = false;
  $("start").disabled = false; $("stop").disabled = true; $("file").disabled = false;
  const done = results.filter(Boolean).length;
  $("start").textContent = done === chunks.length ? "Dịch lại từ đầu" : "Dịch tiếp";
  if (done === chunks.length) setStatus("Xong! Đã dịch " + done + "/" + chunks.length + " đoạn. Bấm “Tải bản dịch” để lưu.");
  else if (stopFlag) setStatus("Đã tạm dừng ở " + done + "/" + chunks.length + " đoạn. Bấm “Dịch tiếp” khi muốn chạy lại.");
  else if (!/^Lỗi/.test($("status").textContent)) setStatus("Dừng với " + failed + " đoạn lỗi. Bấm “Dịch tiếp” để thử lại các đoạn đó.", true);
  updateBar();
}

// Nút "Bắt đầu dịch / Dịch tiếp": nếu đã dịch hết thì xóa kết quả để dịch lại từ đầu
$("start").addEventListener("click", () => {
  if (results.every(Boolean) && chunks.length){ results = chunks.map(() => null); saveProgress(); render(); updateBar(); }
  run();
});
// Nút "Tạm dừng": đặt cờ, vòng lặp sẽ dừng sau đoạn hiện tại
$("stop").addEventListener("click", () => { stopFlag = true; setStatus("Đang dừng sau đoạn hiện tại…"); });

// ---------- 8. TẢI BẢN DỊCH VỀ MÁY ----------
$("dl").addEventListener("click", () => {
  const body = results.map((r, i) => r || ("[Đoạn " + (i+1) + " chưa dịch]")).join("\n\n");
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const name = ($("dropText").querySelector("strong") || {}).textContent || "truyen";
  a.download = name.replace(/\.txt$/i, "") + "_vi.txt";   // tên file: tên-truyện_vi.txt
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

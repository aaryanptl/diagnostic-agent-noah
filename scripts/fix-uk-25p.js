const fs = require('fs');
const { parse } = require('csv-parse/sync');

const inputPath = 'files/mcq_fixed_final_regional_complete.csv';
const outputPath = 'files/mcq_fixed_final_uk_20p.csv';

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function stringifyRows(records) {
  const headers = Object.keys(records[0]);
  return headers.map(csvCell).join(',') + '\n' + records.map((record) => headers.map((header) => csvCell(record[header])).join(',')).join('\n') + '\n';
}

const numberWords = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10,
};

function nValue(value) {
  const s = String(value).toLowerCase().replace(/-/g, ' ').trim();
  return numberWords[s] || Number(s);
}

function coinValue(value) {
  const s = String(value).toLowerCase().replace(/-/g, ' ').trim();
  if (s === 'twenty five' || s === 'twentyfive') return 25;
  if (s === 'twenty') return 20;
  if (s === 'fifty') return 50;
  if (s === 'ten') return 10;
  if (s === 'five') return 5;
  if (s === 'one') return 1;
  return Number(s);
}

function replace25(text) {
  return String(text || '')
    .replace(/(^|[^0-9.])25\s*-\s*pence/gi, '$120-pence')
    .replace(/(^|[^0-9.])25\s+pence/gi, '$120 pence')
    .replace(/(^|[^0-9.])25\s+p\b/gi, '$120 p')
    .replace(/(^|[^0-9.])25p/gi, '$120p')
    .replace(/twenty\s*-\s*five/gi, 'twenty')
    .replace(/twenty\s+five/gi, 'twenty');
}

function has25Denomination(text) {
  return /(?:^|[^0-9.])25\s*(?:p|pence)|(?:^|[^0-9.])25\s*-\s*pence|twenty\s*-?\s*five/i.test(String(text || ''));
}

function parseItems(text) {
  const source = String(text || '').toLowerCase();
  const items = [];
  const re = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:coins?\s+of\s+)?(\d+|one|two|three|four|five|ten|twenty|twenty-five|twenty five)\s*(?:-?p|pence|penny|pennies)\b/g;
  let m;
  while ((m = re.exec(source))) {
    const count = nValue(m[1]);
    const value = coinValue(m[2]);
    if (Number.isFinite(count) && Number.isFinite(value)) items.push({ count, value });
  }
  return items;
}

function totalItems(text) {
  return parseItems(text).reduce((sum, item) => sum + item.count * item.value, 0);
}

function itemSignature(text) {
  return parseItems(text).map((item) => item.count + 'x' + item.value).join('|');
}

function moneyValues(text) {
  const source = String(text || '').toLowerCase();
  const values = [];
  const poundRe = /£\s*(\d+(?:\.\d{1,2})?)/g;
  let m;
  while ((m = poundRe.exec(source))) values.push(Math.round(Number(m[1]) * 100));
  const penceRe = /\b(\d+)\s*(?:p|pence)\b/g;
  while ((m = penceRe.exec(source))) values.push(Number(m[1]));
  return values;
}

function formatPence(value) {
  if (!Number.isFinite(value)) return '';
  if (value >= 100 && value % 100 === 0) return '£' + (value / 100).toFixed(2);
  return value + 'p';
}

function parseCostAndPayment(question) {
  const q = String(question || '');
  const costMatch = q.match(/\b(?:costs?|price is|ticket costs?)\s+(£?\d+(?:\.\d+)?\s*(?:p|pence)?)\b/i);
  const payMatch = q.match(/\b(?:pays?|paid|uses?)\s+(?:with\s+)?([^,.]+?)(?=\.|,|\s+how much|\s+what|$)/i);
  if (!costMatch || !payMatch) return null;
  const cost = groupTotal({ text: costMatch[1] });
  const payment = groupTotal({ text: payMatch[1] });
  if (!Number.isFinite(cost) || !Number.isFinite(payment)) return null;
  return { cost, payment, costText: costMatch[1], paymentText: payMatch[1] };
}

function adjustNegativeChange(question, originalQuestion) {
  if (!/change/i.test(question)) return question;
  const current = parseCostAndPayment(question);
  const original = parseCostAndPayment(originalQuestion);
  if (!current || !original || current.payment >= current.cost) return question;
  const originalChange = original.payment - original.cost;
  if (originalChange < 0) return question;
  const nextCost = current.payment - originalChange;
  if (nextCost < 0) return question;
  return question.replace(current.costText, formatPence(nextCost));
}

function parseQuestionGroupsForComparison(question) {
  const direct = groupsFromQuestion(question);
  if (direct.length >= 2) return direct;
  const parts = String(question || '').split(/\s+and\s+/i).filter((part) => parseItems(part).length || moneyValues(part).length);
  if (parts.length >= 2) return [
    { label: 'first', text: parts[parts.length - 2] },
    { label: 'second', text: parts[parts.length - 1] },
  ];
  const items = parseItems(question);
  if (items.length >= 2) return items.map((item, index) => ({ label: index === 0 ? 'first' : 'second', text: item.count + ' coins of ' + item.value + 'p' }));
  return direct;
}

function groupsFromQuestion(question) {
  const q = String(question || '');
  const groups = [];
  const labelRe = /((?:Group|Jar|Box|Purse|Bag|Set|Plan|Chest|Trail|Basket|Pouch|Pocket|Envelope|Pack|Bank|Path|Trip|Offer|Purse|Pocket)\s+[A-Z0-9]+)\s+(?:has|is|makes|contains|costs)\s+(.+?)(?=\.\s+(?:Group|Jar|Box|Purse|Bag|Set|Plan|Chest|Trail|Basket|Pouch|Pocket|Envelope|Pack|Bank|Path|Trip|Offer|Purse|Pocket)\s+[A-Z0-9]+\s+(?:has|is|makes|contains|costs)|$)/gi;
  let m;
  while ((m = labelRe.exec(q))) groups.push({ label: m[1], text: m[2].trim() });
  if (groups.length >= 2) return groups;

  const personRe = /\b([A-Z][a-z]+)\s+(?:has|finds|found|gets|got|owns)\s+(.+?)(?=\.\s+[A-Z][a-z]+\s+(?:has|finds|found|gets|got|owns)|$)/g;
  while ((m = personRe.exec(q))) groups.push({ label: m[1], text: m[2].trim() });
  if (groups.length >= 2) return groups;

  const articlePersonRe = /\b(?:A|The)\s+([a-z]+)\s+(?:has|finds|found|gets|got|owns)\s+(.+?)(?=\.\s+(?:A|The)\s+[a-z]+\s+(?:has|finds|found|gets|got|owns)|$)/gi;
  while ((m = articlePersonRe.exec(q))) groups.push({ label: m[1], text: m[2].trim() });
  if (groups.length >= 2) return groups;

  const another = q.match(/(?:^|\.\s*)(.+?)\s+Another\s+(.+?)(?:\.|$)/i);
  if (another) return [{ label: 'first', text: another[1] }, { label: 'second', text: another[2] }];

  const orParts = q.split(/\s+or\s+/i);
  if (orParts.length === 2) return [{ label: 'first', text: orParts[0] }, { label: 'second', text: orParts[1] }];

  return [{ label: 'amount', text: q }];
}

function groupTotal(group) {
  const itemTotal = totalItems(group.text);
  if (itemTotal) return itemTotal;
  const values = moneyValues(group.text);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function optionMatchesAmount(text, expected) {
  if (!Number.isFinite(expected)) return false;
  const s = String(text || '').toLowerCase();
  const pound = expected >= 100 ? (expected / 100).toFixed(2) : null;
  if (pound && new RegExp('£\\s*' + pound.replace('.', '\\.') + '\\b').test(s)) return true;
  if (new RegExp('\\b' + expected + '\\s*(?:p|pence)\\b').test(s)) return true;
  if (new RegExp('=\\s*' + expected + '\\b').test(s)) return true;
  return false;
}

function isMathRow(row) {
  const q = row.question_text || '';
  if (/(?:type|sort|sorting|sorted|notes only|coins together|only coins|only notes|note mat|coin mat)/i.test(q)
    && !/(?:total|amount|worth|value|more money|less money|greater|greatest|bigger|same amount|equal amount|change|cost|paid|equation|compare amounts|who has more|price|tax|vat|charge|exactly \d+\s*(?:p|pence)|more than \d+\s*(?:p|pence)|less than \d+\s*(?:p|pence))/i.test(q)) return false;
  return isComparisonRow(q) || /(?:total|amount|worth|value|more money|less money|greater|greatest|bigger|same amount|equal amount|change|cost|paid|exactly|equation|compare amounts|who has more|correct result|add|subtract|spent|left|price|tax|vat|charge|is more|is less|sentence .* correct about|claim about|two money amounts|two money sets)/i.test(q);
}

function isComparisonRow(question) {
  if (/(?:type|sort|sorting|sorted|notes only|coins together|only coins|only notes|note mat|coin mat)/i.test(question)
    && !/(?:more money|same amount|equal amount|compare amounts|who has more)/i.test(question)) return false;
  return /(?:who has more|which .* more|which .* greater|which .* bigger|which .* greatest|which .* most|compare|comparison|more money|same amount|equal|greater than|less than|more than|is more|is less|bigger amount|greater amount|more amount|more for|sentence .* correct about|claim about|two money amounts|two money sets)/i.test(question);
}

function isConstraintRow(question) {
  if (/(?:sorting|sorted|sort|notes only|coins together|only coins|only notes|best fix|fewest moves|note mat|coin mat)/i.test(question)
    && !/(?:exactly \d+\s*(?:p|pence)|more than \d+|less than \d+|at least one)/i.test(question)) return false;
  return /(?:fits all the clues|fits both clues|matches this clue|choose the set that|coin set that|exactly \d+\s*(?:p|pence)|more than .* less than|less than .* more than|at least one|exactly one)/i.test(question);
}

function relationForTotals(totals) {
  if (totals.length < 2 || totals.some((x) => !Number.isFinite(x))) return null;
  const max = Math.max(...totals);
  const min = Math.min(...totals);
  if (max === min) return { kind: 'equal', index: -1 };
  return { kind: 'more', index: totals.indexOf(max) };
}

function optionSideMatch(option, groups, targetIndex) {
  const s = String(option || '').toLowerCase();
  const target = groups[targetIndex];
  if (!target) return false;
  const sig = itemSignature(target.text);
  const optionSig = itemSignature(option);
  if (sig && optionSig === sig) return true;
  const label = target.label.toLowerCase();
  if (label !== 'first' && label !== 'second' && s.includes(label)) return true;
  if (targetIndex === 0 && /\b(first|a|one|noah|jack|monkey|bunny|emma|lily|set a|box a|jar a|bag a|purse a|plan a|group a|chest a|trail a|basket a|pouch a)\b/i.test(s)) return true;
  if (targetIndex === 1 && /\b(second|b|two|ava|rose|sam|leo|set b|box b|jar b|bag b|purse b|plan b|group b|chest b|trail b|basket b|pouch b)\b/i.test(s)) return true;
  const targetTotal = groupTotal(target);
  if (Number.isFinite(targetTotal) && new RegExp('\\b' + targetTotal + '\\s*(?:p|pence)\\b').test(s)) return true;
  return false;
}

function chooseComparison(options, groups) {
  const totals = groups.map(groupTotal);
  const relation = relationForTotals(totals);
  if (!relation) return null;
  const scores = options.map((option) => {
    const s = option.text.toLowerCase();
    let score = 0;
    if (relation.kind === 'equal' && /same|equal|both|neither|no more|same amount/i.test(s)) score += 5;
    if (relation.kind === 'more' && /more|greater|bigger|greatest|most/i.test(s)) {
      if (optionSideMatch(option.text, groups, relation.index)) score += 8;
      else score += 1;
    }
    if (relation.kind === 'more' && /same|equal/i.test(s)) score -= 3;
    return score;
  });
  const best = Math.max(...scores);
  if (best <= 0) return null;
  return scores.indexOf(best);
}

function chooseOptionOnlyComparison(options, question) {
  const totals = options.map(optionCollectionTotal);
  if (totals.some((value) => !Number.isFinite(value))) return null;
  const moreThan = String(question || '').match(/more than\s+(.+?)(?:\.|,|$)/i);
  if (moreThan) {
    const target = totalItems(moreThan[1]);
    const candidates = totals.map((value, index) => value > target ? index : -1).filter((index) => index >= 0);
    if (candidates.length) return candidates.sort((a, b) => totals[b] - totals[a])[0];
  }
  const max = Math.max(...totals);
  const winners = totals.map((value, index) => value === max ? index : -1).filter((index) => index >= 0);
  if (winners.length > 1) {
    const equalOption = options.findIndex((option) => /same|equal/i.test(option.text));
    if (equalOption >= 0) return equalOption;
  }
  return winners.length ? winners[0] : null;
}

function optionCollectionTotal(text) {
  const items = parseItems(text);
  return items.length ? totalItems(text) : null;
}

function deriveExpectedTotal(question) {
  const q = String(question || '');
  const change = parseCostAndPayment(q);
  if (change && /change/i.test(q)) return change.payment - change.cost;

  if (/(?:still needed|coupon)/i.test(q)) {
    let total = 0;
    const unitRe = /\b([a-z][a-z ]+?)\s+for\s+(£?\d+(?:\.\d+)?\s*(?:p|pence)?)\s+each/gi;
    let unitMatch;
    while ((unitMatch = unitRe.exec(q))) {
      const itemName = unitMatch[1].trim().split(/\s+/).slice(-2).join(' ');
      const countMatch = q.match(new RegExp('\\b(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)\\s+' + itemName.replace(/\s+/g, '\\s+') + '\\b', 'i'));
      if (countMatch) total += nValue(countMatch[1]) * groupTotal({ text: unitMatch[2] });
    }
    const eachRe = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+[^.]*?\bfor\s+(£?\d+(?:\.\d+)?\s*(?:p|pence)?)\s+each/gi;
    let m;
    while ((m = eachRe.exec(q))) total += nValue(m[1]) * groupTotal({ text: m[2] });
    const singleRe = /\b(?:one|an)\s+[^.]*?\bcosts?\s+(£?\d+(?:\.\d+)?\s*(?:p|pence)?)/gi;
    while ((m = singleRe.exec(q))) total += groupTotal({ text: m[1] });
    const coupon = q.match(/\b(\d+)\s*(?:p|pence)\b[^.]*coupon|coupon[^.]*?\b(\d+)\s*(?:p|pence)\b/i);
    if (total && coupon) return total - Number(coupon[1] || coupon[2]);
  }

  const groups = groupsFromQuestion(q);
  const costMatch = q.match(/\b(?:costs?|price is)\s+(£?\d+(?:\.\d+)?\s*(?:p|pence)?)\b/i);
  if (costMatch && /(?:more than needed|left after)/i.test(q) && groups.length === 1) {
    const available = groupTotal(groups[0]);
    const cost = groupTotal({ text: costMatch[1] });
    if (Number.isFinite(available) && Number.isFinite(cost)) return available - cost;
  }
  if (groups.length === 1) {
    const total = groupTotal(groups[0]);
    if (Number.isFinite(total)) return total;
  }
  return null;
}

function rewriteCorrectOption(optionText, expected) {
  if (!Number.isFinite(expected)) return optionText;
  const formatted = /pence/i.test(String(optionText || '')) ? expected + ' pence' : formatPence(expected);
  let s = String(optionText || '');
  s = s.replace(/\b25\b(?=\s*\+)/g, '20');
  const items = parseItems(s);
  if (items.some((item) => item.value === 1)) {
    const fixed = items.filter((item) => item.value !== 1).reduce((sum, item) => sum + item.count * item.value, 0);
    const ones = expected - fixed;
    if (Number.isInteger(ones) && ones >= 0) {
      s = s.replace(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:1\s*(?:p|pence)|one\s*(?:p|pence))\s+coins?/i, ones + ' 1p coins');
    }
  }
  if (/=\s*\d+(?:p|\s*pence)?\b/i.test(s)) s = s.replace(/=\s*\d+(?:p|\s*pence)?\b/i, '= ' + formatted);
  else if (/\b(?:£\s*\d+(?:\.\d+)?|\d+\s*(?:p|pence))\b/i.test(s)) {
    const matches = [...s.matchAll(/£\s*\d+(?:\.\d+)?|\d+\s*pence|\d+\s*p\b/gi)];
    if (matches.length) {
      const last = matches[matches.length - 1];
      s = s.slice(0, last.index) + formatted + s.slice(last.index + last[0].length);
    }
  }
  return s;
}

function applyFlags(options, index) {
  return options.map((option, i) => ({ ...option, correct: i === index }));
}

const rows = parse(fs.readFileSync(inputPath, 'utf8'), { columns: true, skip_empty_lines: true, relax_column_count: true });
let affected = 0;
let changedIndex = 0;
let generatedExplanation = 0;
const categories = {};

for (const row of rows) {
  const combined = [row.question_text, row.options, row.explanation].join(' ');
  const questionRef = has25Denomination(row.question_text)
    && /(?:coin|cost|price|paid|pays|amount|value|worth|change|more|less|greater|total|coupon)/i.test(row.question_text);
  const optionCoinRef = /(?:(?:25\s*p|25\s*pence|25\s*-\s*pence)\s+coins?|coins?\s+of\s+(?:25\s*p|25\s*pence|25\s*-\s*pence))/i.test(row.options);
  const analogyRef = /(?:25\s*-\s*pence|25p)\s+coin\s+of/i.test(combined);
  if (row.region !== 'UK' || !(questionRef || optionCoinRef || analogyRef)) continue;
  affected++;
  const originalOptions = JSON.parse(row.options);
  let options = originalOptions.map((option) => ({ ...option, text: replace25(option.text) }));
  const originalQuestion = row.question_text;
  row.question_text = replace25(row.question_text);
  row.explanation = replace25(row.explanation);
  row.question_text = adjustNegativeChange(row.question_text, originalQuestion);
  row.question_text = row.question_text.replace(/one\s+20-pence coin of/gi, 'one quarter of').replace(/20-pence coin of/gi, 'one quarter of');
  options = options.map((option) => ({ ...option, text: option.text.replace(/one\s+20-pence coin of/gi, 'one quarter of').replace(/20-pence coin of/gi, 'one quarter of') }));
  row.explanation = row.explanation.replace(/one\s+20-pence coin of/gi, 'one quarter of').replace(/20-pence coin of/gi, 'one quarter of');

  if (/exactly 45p/i.test(row.question_text)
    && /exactly one 20p coin/i.test(row.question_text)
    && /more money than 4 coins of 10p/i.test(row.question_text)) {
    row.question_text = row.question_text
      .replace(/exactly 45p/gi, 'exactly 40p')
      .replace(/more money than 4 coins of 10p/gi, 'at least as much money as 4 coins of 10p');
  }

  const math = isMathRow(row);
  const comparison = isComparisonRow(row.question_text) && !isConstraintRow(row.question_text);
  const constraint = isConstraintRow(row.question_text);
  let selected = options.findIndex((option) => option.correct);
  let expected = null;
  let manualExplanation = false;
  const equationClue = /total is (\d+)p.*some 1p coins?/i.test(row.question_text);
  const stickerClaim = /4 shiny stickers cost 20 pence each/i.test(row.question_text) && /5 pence left/i.test(row.question_text);
  const multiClaim = /(?:claim about|sentence .* correct about)/i.test(row.question_text) && parseItems(row.question_text).length >= 3;

  if (stickerClaim) {
    options[3].text = 'No, because 4 stickers cost 80 pence, so there are 20 pence left.';
    selected = 3;
    row.explanation = 'Each sticker costs 20 pence, so 4 stickers cost 80 pence. One pound is 100 pence, leaving 20 pence. The seller’s claim of 5 pence left is incorrect.';
    manualExplanation = true;
    categories.total = (categories.total || 0) + 1;
  } else if (equationClue) {
    const target = Number(row.question_text.match(/total is (\d+)p/i)[1]);
    options[selected].text = '20 + 5 + 9 = ' + target + 'p';
    expected = target;
    categories.total = (categories.total || 0) + 1;
  } else if (/5 coins of 5p, 2 coins of 10p, and 1 coin of 20p/i.test(row.question_text)) {
    options[0].text = '2 coins of 10p and 1 coin of 20p are the same amount';
    selected = 0;
    row.explanation = '2 coins of 10p make 20p, and 1 coin of 20p is also 20p. The 5 coins of 5p make 25p, so the first choice is the true claim.';
    manualExplanation = true;
  } else if (/7 coins of 5p, 3 coins of 10p, and 1 coin of 20p plus 1 coin of 10p/i.test(row.question_text)) {
    options[1].text = '3 coins of 10p and 1 coin of 20p plus 1 coin of 10p are equal';
    selected = 1;
    row.explanation = '3 coins of 10p make 30p. A 20p coin and a 10p coin also make 30p, so the second choice is true.';
    manualExplanation = true;
  } else if (/6 coins of 5p, 3 coins of 10p, and 1 coin of 20p plus 1 coin of 5p/i.test(row.question_text)) {
    selected = 2;
    row.explanation = '6 coins of 5p and 3 coins of 10p each make 30p. The 20p and 5p coins make 25p, so the third choice is true.';
    manualExplanation = true;
  } else if (/Choose the coin collection that matches 32p exactly/i.test(row.question_text)) {
    options[0].text = '1 20p coin, 1 5p coin, and 7 1p coins';
    selected = 0;
    row.explanation = '20p + 5p + 7p = 32p, so the first collection matches exactly.';
    manualExplanation = true;
  } else if (/group worth 27p/i.test(row.question_text)) {
    options[0].text = '1 20p coin and 7 1p coins';
    selected = 0;
    row.explanation = '20p + 7p = 27p, so the first group is correct.';
    manualExplanation = true;
  } else if (row.id === '70f2d0a8-b3ec-474d-83f7-e6200132f9a6') {
    options[0].text = '3 coins of 10p';
    selected = 0;
    row.explanation = '2 coins of 10p make 20p. Three coins of 10p make 30p, which is more.';
    manualExplanation = true;
  } else if (row.id === '8f88b9d0-f1fd-49f4-982b-6db0cd710420') {
    options[1].text = '3 5p coins';
    selected = 0;
    row.explanation = 'The 20p coin is greater than 3 coins of 5p (15p), 1 coin of 10p (10p), and 2 coins of 5p (10p).';
    manualExplanation = true;
  } else if (row.id === 'df14a1bc-c145-4c1c-bb06-4bc493af8d3f') {
    options[0].text = '1 20p coin, 1 ten-pence coin, and 1 one-pence coin';
    selected = 0;
    row.explanation = '20p + 10p + 1p = 31p. That is more than 30p, less than 35p, and uses exactly 3 coins.';
    manualExplanation = true;
  } else if (row.id === 'f41666e4-556d-450d-88f3-033247eb2e4d') {
    options[2].text = '2 coins of 10p and 1 coin of 5p';
    selected = 0;
    row.explanation = '4 coins of 10p make 40p, which is more than 35p and less than 50p. The other choices do not fit both limits.';
    manualExplanation = true;
  } else if (row.id === 'bf735e6f-e7ca-4154-b5ac-28a41980ee57') {
    options[3].text = '1 coin of 20p and 1 coin of 10p';
    selected = 0;
    row.explanation = '3 coins of 10p and 2 coins of 5p make 40p. This is more than 20p and more than 2 coins of 10p plus 2 coins of 5p, while staying below 50p.';
    manualExplanation = true;
  } else if (row.id === '4fc5b059-3110-4233-ba81-301f5c188e8e') {
    options[0].text = '2 coins of 10p and 2 coins of 5p';
    options[1].text = '3 coins of 10p and 1 coin of 5p';
    options[2].text = '2 coins of 20p and 1 coin of 5p';
    selected = 2;
    row.explanation = '2 coins of 20p and 1 coin of 5p make 45p. That is more than 40p, less than 55p, and greater than 20p plus 3 coins of 5p.';
    manualExplanation = true;
  } else if (row.id === '5a5de693-aa18-4b7c-974a-9792e2cd3f9e') {
    row.question_text = row.question_text.replace(/same as 1 coin of 20p and 3 coins of 5p/i, 'same as 1 coin of 20p and 4 coins of 5p');
    options[2].text = '1 coin of 20p and 1 coin of 10p';
    selected = 0;
    row.explanation = '1 coin of 20p and 4 coins of 5p make 40p. The first set also makes 40p, which is bigger than 35p and smaller than 45p.';
    manualExplanation = true;
  } else if (row.id === 'fe346e48-e2f9-4e51-9b59-e9fbbb72a652') {
    options[2].text = '2 coins of 20p and 1 coin of 10p';
    selected = 1;
    row.explanation = '4 coins of 10p make 40p, which is more than 30p and less than 50p. The other choices are 25p, 50p, and 30p.';
    manualExplanation = true;
  } else if (row.id === '32f545be-3afd-4c27-ac84-0a907ea4d8c0') {
    options[0].text = '1 coin of 10 pence';
    selected = 1;
    row.explanation = '1 coin of 20 pence is worth 20 pence, which is more than 1 coin of 10 pence, 3 coins of 5 pence, and 2 coins of 5 pence.';
    manualExplanation = true;
  } else if (comparison) {
    const groups = parseQuestionGroupsForComparison(row.question_text);
    const next = multiClaim ? null : (chooseComparison(options, groups) ?? chooseOptionOnlyComparison(options, row.question_text));
    if (next !== null) selected = next;
    categories.comparison = (categories.comparison || 0) + 1;
  } else if (constraint) {
    const targetMatches = row.question_text.match(/(?:exactly|more than|less than|at least)\s+(\d+)\s*(?:p|pence)/i);
    const target = targetMatches ? Number(targetMatches[1]) : null;
    const scores = options.map((option) => {
      const items = parseItems(option.text);
      const total = items.reduce((sum, item) => sum + item.count * item.value, 0);
      let score = 0;
      if (target !== null && /exactly/i.test(row.question_text) && total === target) score += 5;
      if (target !== null && /more than/i.test(row.question_text) && total > target) score += 2;
      if (target !== null && /less than/i.test(row.question_text) && total < target) score += 2;
      const countMatch = row.question_text.match(/exactly\s+(\d+)\s+coins?/i);
      if (countMatch && items.reduce((sum, item) => sum + item.count, 0) === Number(countMatch[1])) score += 3;
      return score;
    });
    const best = Math.max(...scores);
    if (best > 0) selected = scores.indexOf(best);
    categories.constraint = (categories.constraint || 0) + 1;
  } else if (math) {
    expected = /more than needed/i.test(row.question_text) && /costs 22p/i.test(row.question_text) ? 3 : deriveExpectedTotal(row.question_text);
    if (Number.isFinite(expected)) {
      const match = options.findIndex((option) => optionMatchesAmount(option.text, expected));
      if (match >= 0) selected = match;
      else if (optionCollectionTotal(options[selected].text) !== expected) options[selected].text = rewriteCorrectOption(options[selected].text, expected);
    }
    categories.total = (categories.total || 0) + 1;
  } else {
    categories.simple = (categories.simple || 0) + 1;
  }

  if (comparison) {
    const groups = parseQuestionGroupsForComparison(row.question_text);
    const relation = relationForTotals(groups.map(groupTotal));
    if (relation?.kind === 'more') {
      const difference = Math.abs(groups.map(groupTotal)[0] - groups.map(groupTotal)[1]);
      if (Number.isFinite(difference) && /\b\d+\s*p(?:ence)?\s+more\b/i.test(options[selected]?.text || '')) {
        options[selected].text = options[selected].text.replace(/\b\d+\s*p(?:ence)?\s+more\b/i, difference + 'p more');
      }
    }
  }

  if (selected !== originalOptions.findIndex((option) => option.correct)) changedIndex++;
  options = applyFlags(options, selected);

  if (!manualExplanation && math && (expected !== null || comparison || constraint)) {
    const selectedText = options[selected]?.text || '';
    if (comparison) {
      const groups = parseQuestionGroupsForComparison(row.question_text);
      const totals = groups.map(groupTotal);
      const relation = relationForTotals(totals);
      if (relation?.kind === 'equal') row.explanation = 'The two amounts are equal. The correct choice is "' + selectedText + '".';
      else if (relation) row.explanation = 'The amounts are ' + totals.map(formatPence).join(' and ') + '. The larger amount is the one identified by "' + selectedText + '".';
      else row.explanation = 'After calculating the amounts in the question, the correct choice is "' + selectedText + '".';
    } else if (Number.isFinite(expected)) {
      row.explanation = 'The amount calculated from the question is ' + formatPence(expected) + '. Therefore, "' + selectedText + '" is correct.';
    } else if (constraint) {
      row.explanation = 'The correct choice is "' + selectedText + '" because it satisfies all the clues in the question.';
    }
    generatedExplanation++;
  }
  row.options = JSON.stringify(options);
}

for (const row of rows) {
  const cleanAnalogy = (text) => String(text || '')
    .replace(/(?:20|25)-pence coin-gallons/gi, 'quarter-gallons')
    .replace(/one\s+(?:20|25)-pence coin of/gi, 'one quarter of')
    .replace(/(?:Converting to|converting to) (?:20|25)-pence coins/gi, 'Converting the fractions')
    .replace(/25% means one (?:20|25)-pence coin/gi, '25% means one quarter')
    .replace(/5\s+(?:20|25)-pence coins/gi, 'five quarter-kilograms')
    .replace(/four\s+25-pence coins/gi, 'four quarters')
    .replace(/\b((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten))\s+25-(?:fils|cent|pence)\s+coin-gallons/gi, '$1 quarter-gallons');
  row.question_text = cleanAnalogy(row.question_text);
  row.explanation = cleanAnalogy(row.explanation);
  try {
    row.options = JSON.stringify(JSON.parse(row.options).map((option) => ({ ...option, text: cleanAnalogy(option.text) })));
  } catch {}
}

fs.writeFileSync(outputPath, stringifyRows(rows));
console.log(JSON.stringify({ inputRows: rows.length, affected, changedIndex, generatedExplanation, categories, outputPath }, null, 2));

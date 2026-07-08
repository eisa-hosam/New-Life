const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const sectionIds = [
  'group-kitchen',
  'group-plastics',
  'group-glass',
  'group-distribution',
  'group-sets',
  'group-appliances'
];

const sections = sectionIds.map((id) => {
  const sectionMatch = html.match(new RegExp(`<section id="${id}"[\\s\\S]*?</section>`));
  if (!sectionMatch) return { id, title: id, products: [] };

  const sectionHtml = sectionMatch[0];
  const titleMatch = sectionHtml.match(/<h2 class="group-title">([\s\S]*?)<\/h2>/);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : id;

  const products = [];
  const cardRegex = /<div class="product-card">([\s\S]*?)<\/div>\s*(?=<div class="product-card">|<\/div>\s*<\/div>\s*<\/section>)/g;
  let match;
  while ((match = cardRegex.exec(sectionHtml)) !== null) {
    const card = match[1];
    const badgeMatch = card.match(/<span class="badge[^"]*">([^<]+)<\/span>/);
    const imgMatch = card.match(/<img[^>]+src="([^"]+)"/);
    const h3Match = card.match(/<h3>([\s\S]*?)<\/h3>/);
    const pMatch = card.match(/<p>([\s\S]*?)<\/p>/);
    const orderMatch = card.match(/orderProduct\('([^']*)'\)/);

    if (!h3Match) continue;

    products.push({
      badge: badgeMatch ? badgeMatch[1].trim() : null,
      img: imgMatch ? imgMatch[1] : '',
      title: h3Match[1].trim(),
      desc: pMatch ? pMatch[1].trim() : '',
      orderName: orderMatch && orderMatch[1] ? orderMatch[1].trim() : h3Match[1].trim()
    });
  }

  return { id, title, products };
});

fs.writeFileSync('products-data.json', JSON.stringify(sections, null, 2), 'utf8');
console.log('Extracted', sections.reduce((a, s) => a + s.products.length, 0), 'products');

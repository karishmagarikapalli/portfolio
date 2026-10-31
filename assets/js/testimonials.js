(function() {
  'use strict';
  const wrapper = document.querySelector('.testimonials-slider .swiper-wrapper');
  if (!wrapper || !Array.isArray(window.APPROVED_TESTIMONIALS)) return;
  for (const entry of window.APPROVED_TESTIMONIALS) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.quote !== 'string') continue;
    const slide = document.createElement('div');
    slide.className = 'swiper-slide';
    const item = document.createElement('div');
    item.className = 'testimonial-item';
    const quote = document.createElement('p');
    quote.textContent = entry.quote;
    const name = document.createElement('h3');
    name.textContent = entry.name;
    const role = document.createElement('h4');
    role.textContent = typeof entry.role === 'string' ? entry.role : '';
    item.append(quote, name, role);
    slide.append(item);
    wrapper.append(slide);
  }
})();
<script setup>defineProps({ kind: { type: String, default: 'vegetable' } });</script>
<template>
  <svg class="food-art" viewBox="0 0 100 100" role="img" aria-label="食物类别插图，非识别照片">
    <ellipse cx="50" cy="80" rx="33" ry="6" class="art-shadow" />
    <g v-if="kind === 'egg'"><path d="M48 19C32 17 16 47 20 64c4 19 27 23 37 5 9-17 2-47-9-50Z" class="art-cream"/><path d="M67 31c-16 0-34 28-29 41 6 15 34 15 43-1 8-15-3-39-14-40Z" class="art-white"/><ellipse cx="62" cy="63" rx="13" ry="15" class="art-yolk"/></g>
    <g v-else-if="kind === 'rice'"><path d="M17 51h66c-2 25-14 32-33 32S19 75 17 51" class="art-bowl"/><path d="M20 51C16 39 24 35 29 33c0-10 11-12 17-9 7-9 17-3 18 4 12-2 20 10 15 23Z" class="art-white"/><path d="m33 37 4-3m10 9 4-3m12-7 3 3m-9-7 2-1" class="art-lines"/></g>
    <g v-else-if="kind === 'drink'"><path d="M29 23h44l-5 61H35Z" class="art-glass"/><path d="M33 38h36l-3 43H37Z" class="art-cream"/><path d="M63 36 68 12h13" class="art-straw"/><ellipse cx="50" cy="38" rx="18" ry="3" class="art-white"/></g>
    <g v-else-if="kind === 'chicken'"><path d="M21 57c1-17 20-33 40-27 21 6 25 19 13 33-12 15-51 22-53-6Z" class="art-chicken"/><path d="m37 43 13 21m0-28 13 20m-39 4 10 12" class="art-grill"/></g>
    <g v-else-if="kind === 'fruit'"><path d="M48 30C15 13 9 42 24 64c19 26 31 15 43-1 19-24 8-50-19-33Z" class="art-fruit"/><path d="M48 31 52 16" class="art-lines"/><path d="M51 22c1-16 20-15 24-9-5 11-16 15-24 9Z" class="art-leaf"/><path d="M28 38q-6 7-1 15" class="art-shine"/></g>
    <g v-else-if="kind === 'bread'"><path d="M18 51c-8-8-5-18 3-22 17-8 42-8 58 1 10 5 8 17 2 22v31H19Z" class="art-bread"/><path d="M29 43q-4-12 5-14m16 9q-2-9 5-13m14 17q4-8-1-13" class="art-grill"/></g>
    <g v-else-if="kind === 'broccoli'"><path d="m42 47 2 38h19L57 48" class="art-stem"/><path d="M25 29c-14 1-15 23-3 27 2 14 22 19 31 7 11 8 26 1 28-12 11-12-2-28-13-25-5-14-26-15-32-2-5-1-10 1-11 5Z" class="art-leaf"/><path d="m34 48 15 19 14-20" class="art-vein"/></g>
    <g v-else-if="kind === 'potato'"><ellipse cx="37" cy="48" rx="22" ry="28" class="art-bread" transform="rotate(25 37 48)"/><ellipse cx="62" cy="61" rx="23" ry="19" class="art-cream"/><path d="m27 34 3 2m8 20 2 3m17 1 3-2m9 11 3 1" class="art-grill"/></g>
    <g v-else-if="kind === 'pineapple'"><path d="M26 43 50 28 75 43 70 78 30 78Z" class="art-yolk"/><path d="m32 44 33 25m3-25L36 70" class="art-grill"/><path d="m49 31-16-19 17 8 11-15 1 18 17-7-15 19" class="art-leaf"/></g>
    <g v-else-if="kind === 'berries'"><path d="M21 33q20-18 36 2c9 18-6 40-20 46C18 65 9 46 21 33Z" class="art-fruit"/><path d="m22 32 14-11 16 12-15 8Z" class="art-leaf"/><circle cx="69" cy="53" r="13" class="art-bowl"/><circle cx="60" cy="73" r="12" class="art-bowl"/><path d="m25 45 1 2m15 9 1 2m-11 7 1 2" class="art-shine"/></g>
    <g v-else><path d="M49 84C15 73 12 26 35 21c6-18 26-13 29 2 23-1 24 32 4 46Z" class="art-leaf"/><path d="M48 84c-9-23-17-49-7-59 12-12 27 8 7 59" class="art-light-leaf"/><path d="m48 82-1-52M40 58l7 8 10-13" class="art-vein"/></g>
  </svg>
</template>

/**
 * Canvas Renderer with Dynamic Camera & Relative Scale
 */
class Renderer {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = state;

    this.auraParticles = [];
    this.bounceOffset = 0;
    this.bounceVelocity = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  triggerFeedAura() {
    // Create aura particle burst
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4.5;
      this.auraParticles.push({
        x: 0,
        y: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 3 + Math.random() * 5,
        alpha: 1,
        color: ['#f6e05e', '#68d391', '#63b3ed', '#ed8936', '#b794f4'][Math.floor(Math.random() * 5)]
      });
    }
    // Bounce effect
    this.bounceVelocity = -10;
  }

  updateAnimation() {
    // Bounce physics
    this.bounceOffset += this.bounceVelocity;
    if (this.bounceOffset < 0) {
      this.bounceVelocity += 0.6; // gravity
    } else {
      this.bounceOffset = 0;
      this.bounceVelocity = 0;
    }

    // Update aura particles
    for (let i = this.auraParticles.length - 1; i >= 0; i--) {
      const p = this.auraParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= 0.025;
      if (p.alpha <= 0) {
        this.auraParticles.splice(i, 1);
      }
    }
  }

  render() {
    this.updateAnimation();

    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);

    ctx.save();

    const pet = this.state.data.pet;
    const scaleFactor = pet.scale || 1.0;

    // Center point of screen
    const centerX = width / 2;
    const centerY = height / 2 + 20;

    // 1. Draw Environment (Shrinks relative to Pet scale)
    ctx.save();
    ctx.translate(centerX, centerY);

    // Relative scaling: As pet level/scale grows, environment shrinks
    const envScale = 1 / Math.pow(scaleFactor, 0.7);
    ctx.scale(envScale, envScale);

    this.drawEnvironment(ctx);
    ctx.restore();

    // 2. Draw Pet (Keeps centered standard screen focus, animated)
    ctx.save();
    ctx.translate(centerX, centerY + this.bounceOffset);

    // Draw Slime Pet
    this.drawSlimePet(ctx, pet);

    // Draw Aura Particles around pet
    this.drawAuraParticles(ctx);

    ctx.restore();

    ctx.restore();
  }

  drawEnvironment(ctx) {
    // Ground Grid & Grass Tiles
    const gridSize = 64;
    const gridCols = 18;
    const gridRows = 18;
    const startX = - (gridCols * gridSize) / 2;
    const startY = - (gridRows * gridSize) / 2;

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const x = startX + c * gridSize;
        const y = startY + r * gridSize;
        ctx.fillStyle = ((r + c) % 2 === 0) ? '#2f855a' : '#276749';
        ctx.fillRect(x, y, gridSize, gridSize);
      }
    }

    // Outer Boundary Wall/Fence
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 6;
    ctx.strokeRect(startX, startY, gridCols * gridSize, gridRows * gridSize);

    // Render Farm Plots in World Environment
    const plotPositions = [
      { x: -160, y: -160 },
      { x: 80, y: -160 },
      { x: -160, y: 80 },
      { x: 80, y: 80 }
    ];

    const farmPlots = this.state.data.farmPlots || [];
    farmPlots.forEach((plot, i) => {
      if (i < plotPositions.length) {
        const pos = plotPositions[i];

        // Soil Plot
        ctx.fillStyle = '#744210';
        ctx.fillRect(pos.x, pos.y, 80, 80);
        ctx.strokeStyle = '#975a16';
        ctx.lineWidth = 3;
        ctx.strokeRect(pos.x, pos.y, 80, 80);

        // Crop Graphic
        ctx.font = '32px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (plot.state === 'planted' && plot.cropId) {
          const crop = CONFIG.CROPS[plot.cropId];
          ctx.fillText('🌱', pos.x + 40, pos.y + 40);
        } else if (plot.state === 'ready' && plot.cropId) {
          const crop = CONFIG.CROPS[plot.cropId];
          ctx.fillText(crop.icon || '🌾', pos.x + 40, pos.y + 40);
        } else {
          ctx.fillText('🟫', pos.x + 40, pos.y + 40);
        }
      }
    });

    // Environmental Props (Trees, Rocks, Flowers)
    const props = [
      { x: -400, y: -350, icon: '🌲' },
      { x: 380, y: -320, icon: '🌲' },
      { x: -380, y: 350, icon: '🪨' },
      { x: 420, y: 320, icon: '🌳' },
      { x: -200, y: -400, icon: '🌻' },
      { x: 220, y: -380, icon: '🍄' },
      { x: -450, y: 0, icon: '🪵' },
      { x: 450, y: 0, icon: '🪨' }
    ];

    ctx.font = '36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    props.forEach(p => {
      ctx.fillText(p.icon, p.x, p.y);
    });
  }

  drawSlimePet(ctx, pet) {
    const time = Date.now() * 0.003;
    const squish = Math.sin(time) * 4;

    const baseWidth = 100;
    const baseHeight = 80;

    const w = baseWidth + squish;
    const h = baseHeight - squish;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 35, w * 0.55, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // High Level Glow Aura
    if (pet.level >= 5) {
      ctx.shadowColor = '#f6e05e';
      ctx.shadowBlur = 15;
    } else {
      ctx.shadowBlur = 0;
    }

    // Slime Body Color
    let bodyColor = '#48bb78'; // Green (Healthy)
    if (pet.hp < pet.maxHp * 0.3) {
      bodyColor = '#e53e3e'; // Red (Low HP)
    } else if (pet.hunger < 30) {
      bodyColor = '#ed8936'; // Orange (Hungry)
    } else if (pet.level >= 10) {
      bodyColor = '#9f7aea'; // Purple (High level magic slime)
    }

    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, [35, 35, 12, 12]);
    ctx.fill();
    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;

    // Shiny Specular Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.roundRect(-w / 2 + 12, -h / 2 + 10, w * 0.32, h * 0.22, [10]);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#1a202c';
    ctx.beginPath();
    ctx.arc(-w * 0.2, -h * 0.1, 7, 0, Math.PI * 2);
    ctx.arc(w * 0.2, -h * 0.1, 7, 0, Math.PI * 2);
    ctx.fill();

    // Eye Glint
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-w * 0.2 + 2, -h * 0.1 - 2, 2.5, 0, Math.PI * 2);
    ctx.arc(w * 0.2 + 2, -h * 0.1 - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Facial Expression based on HP/Hunger
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (pet.hp < pet.maxHp * 0.3 || pet.hunger < 25) {
      // Sad / Wounded
      ctx.arc(0, h * 0.22, 9, Math.PI, 0, false);
    } else {
      // Happy / Smiling
      ctx.arc(0, h * 0.08, 9, 0, Math.PI, false);
    }
    ctx.stroke();

    // Crown for Level >= 5
    if (pet.level >= 5) {
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('👑', 0, -h / 2 - 12);
    }
  }

  drawAuraParticles(ctx) {
    this.auraParticles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
}

if (typeof window !== 'undefined') {
  window.Renderer = Renderer;
}
if (typeof module !== 'undefined') {
  module.exports = Renderer;
}

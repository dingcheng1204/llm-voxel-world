import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GEAR } from '../player/equipment';
import { createWeaponModel, HeldGear, shieldColor } from './gearModels';

describe('gear models', () => {
  it('every weapon has a model; armor and shoes do not', () => {
    for (const g of Object.values(GEAR)) {
      const m = createWeaponModel(g.id);
      if (g.weapon) {
        expect(m, g.id).not.toBeNull();
        m!.dispose();
      } else expect(m).toBeNull();
    }
    expect(createWeaponModel(null)).toBeNull();
  });

  it('shows the shield only while guarding with armor equipped', () => {
    const parent = new THREE.Group();
    const held = new HeldGear(parent);
    held.setGear('stick', 'wood_shield');
    held.update(0, true, 0);
    expect(held.shield.visible).toBe(true);
    held.setGear('stick', null);
    held.update(0, true, 0);
    expect(held.shield.visible).toBe(false);
    expect(shieldColor('stone_shield')).not.toBe(shieldColor('wood_shield'));
    held.dispose();
  });
});

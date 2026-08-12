Component({
  properties: {
    item: { type: Object, value: {} },
    kind: { type: String, value: 'paper' },
    compact: { type: Boolean, value: false },
    badge: { type: String, value: '' }
  },
  methods: {
    open() {
      this.triggerEvent('open', { item: this.data.item });
    }
  }
});

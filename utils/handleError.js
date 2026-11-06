/** One place to turn thrown errors into safe JSON responses. */
module.exports = (res, err) => {
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((e) => e.message).join(', ');
    return res.status(400).json({ success: false, message });
  }
  if (err.code === 11000) {
    return res.status(409).json({ success: false, message: 'That record already exists or the slot was just taken' });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, message: 'Invalid ID or value' });
  }
  console.error(err);
  return res.status(500).json({ success: false, message: 'Server error' });
};

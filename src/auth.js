import jwt from 'jsonwebtoken'

export const verifyToken = (req, res, next) => {
  const bearerHeader = req.headers['authorization']

  if (!bearerHeader) {
    return res.status(401).json({ error: 'Acesso negado.' })
  }

  const token = bearerHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next() 
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' })
  }
}
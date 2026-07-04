import jwt from 'jsonwebtoken'

export const verifyToken = (req, res, next) => {
  const bearerHeader = req.headers['authorization']

  if (!bearerHeader || !bearerHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acesso negado. Token de autenticação ausente ou mal formatado.' })
  }

  const token = bearerHeader.split(' ')[1]
  const secret = process.env.JWT_SECRET

  if (!secret) {
    console.error('❌ ERRO CRÍTICO: JWT_SECRET não configurado no ambiente (--env-file).')
    return res.status(500).json({ error: 'Erro interno de configuração de segurança.' })
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] })
    req.user = decoded
    next()
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' })
  }
}
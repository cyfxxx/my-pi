import type { InteractionProvider, InteractionService, ApprovalRequest, ApprovalResult, AskQuestion, AskResult, Notification } from './types.ts'

/** 终端交互 Provider */
export const terminalInteractionProvider: InteractionProvider = {
  name: 'terminal',
  seam: 'interaction',
  description: '终端交互（readline）',
  impl: {
    async approve(request: ApprovalRequest): Promise<ApprovalResult> {
      // 在终端中显示 approval 请求
      const riskIcon = request.risk === 'high' ? '⚠️' : request.risk === 'medium' ? '⚡' : 'ℹ️'

      console.log(`\n${riskIcon} Approval Required`)
      console.log(`Type: ${request.type}`)
      console.log(`Description: ${request.description}`)
      if (request.details) {
        console.log(`Details: ${JSON.stringify(request.details, null, 2)}`)
      }
      console.log(`Risk: ${request.risk}`)
      console.log(`\nApprove? (y/n): `)

      // 简单的 stdin 读取
      const answer = await readLine()
      const approved = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'

      return {
        approved,
        reason: approved ? 'User approved' : 'User rejected',
      }
    },

    async ask(question: AskQuestion): Promise<AskResult> {
      console.log(`\n${question.question}`)
      if (question.options && question.options.length > 0) {
        console.log('\nOptions:')
        for (let i = 0; i < question.options.length; i++) {
          const opt = question.options[i]
          console.log(`  ${i + 1}. ${opt.label}${opt.description ? ` - ${opt.description}` : ''}`)
        }
        console.log(`\nSelect (1-${question.options.length}${question.allowCustom ? ' or custom' : ''}): `)
      } else {
        console.log('\nAnswer: ')
      }

      const answer = await readLine()
      const index = parseInt(answer, 10) - 1

      if (question.options && index >= 0 && index < question.options.length) {
        return {
          answer: question.options[index].value,
          label: question.options[index].label,
        }
      }

      return { answer }
    },

    async notify(notification: Notification): Promise<void> {
      const icon = notification.level === 'error' ? '❌'
        : notification.level === 'warning' ? '⚠️'
        : notification.level === 'success' ? '✅'
        : 'ℹ️'

      console.log(`\n${icon} ${notification.title}`)
      console.log(`   ${notification.message}`)
    },
  },
}

/** 读取一行输入 */
function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const readline = require('readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    rl.on('line', (line: string) => {
      rl.close()
      resolve(line.trim())
    })
  })
}

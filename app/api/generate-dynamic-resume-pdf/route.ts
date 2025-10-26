import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { OpenAI } from 'openai';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Helper to parse resume text
function parseResume(resumeText: string) {
  const lines = resumeText.split('\n');
  const info: string[] = [];
  let bodyStart = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx].trim()) info.push(lines[idx].trim());
    if (info.length === 6) {
      bodyStart = idx + 1;
      break;
    }
  }
  const [headline, name, email, phone, location, linkedin] = info;
  while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;
  const body = lines.slice(bodyStart).join('\n');
  return { headline, name, email, phone, location, linkedin, body };
}

// Helper to build OpenAI prompt
function buildPrompt(baseResume: string, jobDescription: string) {
  return `
You are a world-class technical resume assistant.

SYSTEM INSTRUCTION: Make the resume align as closely as possible with the Job Description (JD). Must proactively REPLACE, REPHRASE, and ADD bullet points under each Experience entry, especially recent/current roles, to ensure the language, skills, and technologies match the JD specifically. Do NOT leave any Experience section or bullet point unchanged if it could better reflect or incorporate keywords, duties, or requirements from the JD. Acceptable and encouraged to write NEW bullet points where there are relevant experiences (even if not previously mentioned). Prioritize jobs/roles closest to the desired job.

Your main objectives:
1. Maximize keyword/skills and responsibilities match between the resume and the job description (JD). Use the exact relevant technology, tool, process, or methodology names from the JD wherever accurate.
2. Preserve all original company names, job titles, and periods/dates in the Professional Experience section.
3. In each Experience/job entry, ensure 6–8 highly relevant and impactful bullet points. Aggressively update, rewrite, or add new ones so they reflect the actual duties, skills, or stacks requested in the JD—especially prioritizing skills, tools, or requirements from the current and most recent positions. If an original bullet or responsibility does not closely match the JD, replace or revise it.
4. Make the experiences emphasize the main tech stack from the JD in the most recent or relevant roles, and distribute additional or secondary JD requirements across earlier positions naturally. Each company’s experience should collectively cover the full range of JD skills and duties.
5. Place the SKILLS section immediately after the SUMMARY section and before the PROFESSIONAL EXPERIENCE section. This ensures all key stacks and technologies are visible at the top of the resume for ATS and recruiters.
6. In the Summary, integrate the most essential and high-priority skills, stacks, and requirements from the JD, emphasizing the strongest elements from the original. Keep it dense with relevant keywords and technologies, but natural in tone.
7. In every section (Summary, Skills, Experience), INCLUDE as many relevant unique keywords and technologies from the job description as possible.
8. CRITICAL SKILLS SECTION: Create an EXCEPTIONALLY RICH, DENSE, and COMPREHENSIVE Skills section. Extract and list EVERY technology, tool, framework, library, service, and methodology from BOTH the JD AND candidate's experience. Make it so comprehensive it dominates keyword matching.
MANDATORY STRUCTURE (IN THIS EXACT FORMAT):
Testing & QA Methodologies
Automation & Tools
Programming & Scripting
DevOps & Cloud
Quality Management & Compliance
Data & Reporting

Each category must have 12–20+ comma-separated skills, prioritizing JD keywords first. Follow the sample formatting and grouping rules as defined earlier.
9. Preserve all original quantified metrics (numbers, percentages, etc.) and actively introduce additional quantification in new or reworded bullets wherever possible. Use measurable outcomes, frequency, scope, or scale to increase the impact of each responsibility or accomplishment. Strive for at least 75% of all Experience bullet points to include a number, percentage, range, or scale to strengthen ATS, recruiter, and hiring manager perception.
10. Strictly maximize verb variety: No action verb (e.g., developed, led, built, designed, implemented, improved, created, managed, engineered, delivered, optimized, automated, collaborated, mentored) may appear more than twice in the entire document, and never in adjacent or back-to-back bullet points within or across jobs. Each bullet must start with a unique, action-oriented verb whenever possible.
11. In all Experience bullets, prefer keywords and phrasing directly from the JD where it truthfully reflects the candidate's background and would boost ATS/recruiter relevance.
12. Distribute JD-aligned technologies logically across roles.
- Assign primary/core technologies from the JD to the most recent or relevant positions.
- Assign secondary or supporting technologies to earlier roles.
- Ensure all key JD technologies appear at least once across the resume.

13. Ensure natural tone and realism. Only include technologies or responsibilities that the candidate could reasonably have used, based on their career path or industry.
14. The final resume should read as cohesive, naturally written, and contextually plausible—not artificially optimized.
15. Maintain all original section headers and formatting. Do not include commentary or extra text outside the resume.
Here is the base resume:
16. Include explicit database-related experience in the Professional Experience section.
17. Set the number of experiences in each company as 7-9 and each sentence must be 30-40 words long
${baseResume}

Here is the target job description:

${jobDescription}

Output the improved resume as plain text, exactly following the original resume's format—including the unchanged headline at the top. Clearly label sections (Summary, Professional Experience, Skills, Education, etc) with original spacing, section order, and no decorative lines or symbols.
  `;
}

// Helper to convert date format from MM/YYYY to MMM YYYY
function formatDate(dateStr: string): string {
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  // Handle different date formats
  if (dateStr.includes('–') || dateStr.includes('-')) {
    // Split by dash and format each part
    const parts = dateStr.split(/[–-]/).map(part => part.trim());
    return parts.map(part => {
      if (part.match(/^\d{2}\/\d{4}$/)) {
        const [month, year] = part.split('/');
        const monthIndex = parseInt(month) - 1;
        return `${monthNames[monthIndex]} ${year}`;
      }
      return part; // Return as-is if not in MM/YYYY format
    }).join(' – ');
  } else if (dateStr.match(/^\d{2}\/\d{4}$/)) {
    // Single date in MM/YYYY format
    const [month, year] = dateStr.split('/');
    const monthIndex = parseInt(month) - 1;
    return `${monthNames[monthIndex]} ${year}`;
  }

  return dateStr; // Return as-is if not in expected format
}

// Helper to wrap text within a max width
function wrapText(text: string, font: any, size: number, maxWidth: number) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  for (let i = 0; i < words.length; i++) {
    const testLine = currentLine ? currentLine + ' ' + words[i] : words[i];
    const testWidth = font.widthOfTextAtSize(testLine, size);
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = words[i];
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// Helper to draw text with bold segments (markdown **bold**)
function drawTextWithBold(
  page: any,
  text: string,
  x: number,
  y: number,
  font: any,
  fontBold: any,
  size: number,
  color: any
) {
  // Split by ** for bold
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  let offsetX = x;
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      const content = part.slice(2, -2);
      page.drawText(content, { x: offsetX, y, size, font: fontBold, color });
      offsetX += fontBold.widthOfTextAtSize(content, size);
    } else {
      page.drawText(part, { x: offsetX, y, size, font, color });
      offsetX += font.widthOfTextAtSize(part, size);
    }
  }
}

// PDF generation function
async function generateResumePdf(resumeText: string): Promise<Uint8Array> {
  const { name, email, phone, location, linkedin, body } = parseResume(resumeText);

  console.log('resumeText', resumeText);
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Color scheme for better visual hierarchy
  const BLACK = rgb(0, 0, 0);
  const DARK_BLUE = rgb(0.1, 0.2, 0.4); // For section headers
  const MEDIUM_BLUE = rgb(0.2, 0.4, 0.6); // For job titles
  const GRAY = rgb(0.4, 0.4, 0.4); // For company names and periods
  const DARK_GRAY = rgb(0.2, 0.2, 0.2); // For contact info

  const MARGIN_TOP = 72; // 1 inch = 72 points
  const MARGIN_BOTTOM = 50;
  const MARGIN_LEFT = 50;
  const MARGIN_RIGHT = 50;
  const PAGE_WIDTH = 595;
  const PAGE_HEIGHT = 842;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

  // ATS-friendly font sizes
  const NAME_SIZE = 24; // Increased from 20 to 24 for better prominence
  const CONTACT_SIZE = 9; // Reduced from 10 to 9 (1px smaller)
  const SECTION_HEADER_SIZE = 14; // Increased from 12 to 14 for better visibility
  const BODY_SIZE = 11; // 10-12pt for body text

  // ATS-friendly line spacing (1.15 - 1.5 line height)
  const NAME_LINE_HEIGHT = NAME_SIZE * 0.8;
  const CONTACT_LINE_HEIGHT = CONTACT_SIZE * 1.5;
  const SECTION_LINE_HEIGHT = SECTION_HEADER_SIZE * 1.5;
  const BODY_LINE_HEIGHT = BODY_SIZE * 1.4;

  let y = PAGE_HEIGHT - MARGIN_TOP;
  const left = MARGIN_LEFT;
  const right = PAGE_WIDTH - MARGIN_RIGHT;

  // Name (large, bold, dark blue) - uppercase for emphasis
  if (name) {
    const nameLines = wrapText(name.toUpperCase(), fontBold, NAME_SIZE, CONTENT_WIDTH);
    for (const line of nameLines) {
      page.drawText(line, { x: left, y, size: NAME_SIZE, font: fontBold, color: DARK_BLUE });
      y -= NAME_LINE_HEIGHT;
    }
    y -= 2; // Small gap after name
  } else {
    y -= NAME_LINE_HEIGHT;
  }

  // Contact info on single line with bullet separators (like the image)
  const contactParts = [
    location,
    phone,
    email,
    linkedin
  ].filter(Boolean);

  if (contactParts.length > 0) {
    const contactLine = contactParts.join(' • ');
    const contactLines = wrapText(contactLine, font, CONTACT_SIZE, CONTENT_WIDTH);
    for (const line of contactLines) {
      page.drawText(line, { x: left, y, size: CONTACT_SIZE, font, color: DARK_GRAY });
      y -= CONTACT_LINE_HEIGHT;
    }
    y -= 4; // Small gap before horizontal line
  }

  // Draw horizontal line under contact info (like the image)
  page.drawLine({
    start: { x: left, y: y },
    end: { x: right, y: y },
    thickness: 1.5,
    color: DARK_BLUE
  });
  y -= 16; // Gap after horizontal line

  // Body (sections, skills, etc., wrapped)
  const bodyLines = body.split('\n');
  let inSkillsSection = false;
  const skills: string[] = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i].trim();
    if (!line) {
      y -= 6; // Reduced gap between paragraphs for ATS
      continue;
    }
    if (line.endsWith(':')) {
      y -= 12; // Increased gap before section header for better separation
      const sectionLines = wrapText(line, fontBold, SECTION_HEADER_SIZE, CONTENT_WIDTH);
      for (const sectionLine of sectionLines) {
        page.drawText(sectionLine, { x: left, y, size: SECTION_HEADER_SIZE, font: fontBold, color: DARK_BLUE });
        y -= SECTION_LINE_HEIGHT;
        if (y < MARGIN_BOTTOM) {
          page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
          y = PAGE_HEIGHT - MARGIN_TOP;
        }
      }
      // Detect start of Skills section
      if (line.toLowerCase() === 'skills:') {
        inSkillsSection = true;
      }
    } else {
      // Check if this is a job experience line (Role at Company: Period)
      const isJobExperience = / at .+:.+/.test(line);

      if (isJobExperience) {
        // Parse job experience: Role at Company: Period
        const match = line.match(/^(.+?) at (.+?):\s*(.+)$/);
        if (match) {
          const [, jobTitle, companyName, period] = match;

          y -= 8; // Extra gap before job entry

          // Job Title (bold, blue)
          const titleLines = wrapText(jobTitle.trim(), fontBold, BODY_SIZE + 1, CONTENT_WIDTH - 10);
          for (const titleLine of titleLines) {
            page.drawText(titleLine, { x: left + 10, y, size: BODY_SIZE + 1, font: fontBold, color: MEDIUM_BLUE });
            y -= BODY_LINE_HEIGHT + 2;
            if (y < MARGIN_BOTTOM) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN_TOP;
            }
          }

          // Company Name (italic, gray)
          const companyLines = wrapText(companyName.trim(), font, BODY_SIZE, CONTENT_WIDTH - 10);
          for (const companyLine of companyLines) {
            page.drawText(companyLine, { x: left + 10, y, size: BODY_SIZE, font, color: GRAY });
            y -= BODY_LINE_HEIGHT;
            if (y < MARGIN_BOTTOM) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN_TOP;
            }
          }

          // Period (formatted and styled)
          const formattedPeriod = formatDate(period.trim());
          const periodLines = wrapText(formattedPeriod, font, BODY_SIZE - 1, CONTENT_WIDTH - 10);
          for (const periodLine of periodLines) {
            page.drawText(periodLine, { x: left + 10, y, size: BODY_SIZE - 1, font, color: GRAY });
            y -= BODY_LINE_HEIGHT - 2;
            if (y < MARGIN_BOTTOM) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN_TOP;
            }
          }

          y -= 4; // Gap before experience bullets
        }
      } else {
        // Check if this is a skills category line (starts with ·)
        const isSkillsCategory = line.startsWith('·');

        if (isSkillsCategory) {
          // Skills category header (bold, dark blue)
          const categoryName = line.trim(); // Remove the · symbol
          const categoryLines = wrapText(categoryName, fontBold, BODY_SIZE + 1, CONTENT_WIDTH - 20);
          for (const categoryLine of categoryLines) {
            page.drawText(categoryLine, { x: left + 10, y, size: BODY_SIZE + 1, font: fontBold, color: MEDIUM_BLUE });
            y -= BODY_LINE_HEIGHT + 2;
            if (y < MARGIN_BOTTOM) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN_TOP;
            }
          }
        } else {
          // Regular body text with proper indentation and line height
          const wrappedLines = wrapText(line, font, BODY_SIZE, CONTENT_WIDTH - 10); // indent body
          for (const wrappedLine of wrappedLines) {
            drawTextWithBold(page, wrappedLine, left + 10, y, font, fontBold, BODY_SIZE, BLACK);
            y -= BODY_LINE_HEIGHT;
            if (y < MARGIN_BOTTOM) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN_TOP;
            }
          }
        }
      }
    }
    if (y < MARGIN_BOTTOM) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN_TOP;
    }
  }
  // If the document ends while still in the skills section, render the skills
  if (inSkillsSection && skills.length > 0) {
    // Render comma-separated skills as wrapped text with better styling
    const skillsText = skills.join(' ');
    const wrappedSkillLines = wrapText(skillsText, font, BODY_SIZE, CONTENT_WIDTH - 20);
    for (const skillLine of wrappedSkillLines) {
      page.drawText(skillLine, { x: left + 20, y, size: BODY_SIZE, font, color: DARK_GRAY });
      y -= BODY_LINE_HEIGHT;
      if (y < MARGIN_BOTTOM) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN_TOP;
      }
    }
  }

  return await pdfDoc.save();
}

export async function POST(req: NextRequest) {
  try {
    // 1. Parse form data
    const formData = await req.formData();
    const jobDescription = formData.get('job_description') as string;
    const company = formData.get('company') as string;
    const role = formData.get('role') as string;

    // Validate required fields
    if (!jobDescription || !company || !role) {
      return new NextResponse(
        JSON.stringify({ error: 'Missing required fields: job_description, company, role' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check for OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return new NextResponse(
        JSON.stringify({ error: 'OpenAI API key not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Load base resume from app directory (Vercel compatible)
    let baseResume: string = `
Senior Software Engineer

Zackery Jackson
Senior QA Automation Lead
jacksonzackery9320@outlook.com
+1 325 313 0928
Miami, FL, USA

Summary: 

Senior QA Automation Lead / SDET with over 12 years of experience designing and implementing automation frameworks and QA strategies 
for enterprise web and mobile platforms. Expert in Selenium, Cypress, Playwright, and API testing, with deep experience integrating test automation 
into CI/CD pipelines using Jenkins, GitLab, and Docker. Proven success leading QA initiatives at Warner Bros. Discovery, CNN, and Cox Automotive, 
improving test efficiency, quality coverage, and delivery speed. Passionate about shift-left testing, continuous improvement, and building high-performing QA teams.

Professional Experience:

Senior QA Lead at Warner Bros. Discovery: 08/2023 - Current
•	Architected a scalable test automation framework using Python (Pytest), Selenium, and Playwright, seamlessly integrated into GitLab CI/CD pipelines, enabling continuous validation of microservices with over 80% regression coverage across multiple environments.
•	Developed and maintained end-to-end UI automation suites for React.js front-end applications within the Registration, Messaging, and Ads teams, reducing manual testing time by 60% and ensuring faster deployment cycles.
•	Implemented comprehensive load and performance testing strategies using k6 and Grafana, diagnosing bottlenecks and enhancing service response times by 35% under peak traffic conditions.
•	Designed automated API test collections in Postman and Newman, validating RESTful endpoints for revenue reporting, campaign analytics, and user management services.
•	Introduced shift-left testing practices by embedding QA validation into development pipelines, enabling early defect detection and reducing post-deployment issues by 45%.
•	Led sprint planning and test strategy sessions as part of the Technical Center of Excellence (TCOE), aligning QA processes with agile development standards and organizational KPIs.
•	Established centralized QA documentation repositories, including test plans, execution reports, and automation guides, standardizing team workflows and reducing onboarding time for new engineers.
•	Mentored a team of six QA engineers on automation design patterns, code review processes, and advanced debugging techniques, elevating overall testing efficiency across the group.

Senior QA Analyst at WarnerMedia: 04/2021 - 08/2023
•	Designed and implemented Cypress and Selenium WebDriver frameworks to automate testing for high-visibility CNN platforms like Magic Wall, Facts First, and the Election Center, ensuring consistent, accurate, and timely data rendering.
•	Automated complex backend validation scripts for REST APIs, focusing on real-time election data synchronization and results accuracy, which improved system reliability during peak broadcast events.
•	Integrated automated testing workflows into Jenkins pipelines, cutting manual regression efforts by 65% and improving build verification turnaround from two days to under three hours.
•	Performed cross-browser and responsive testing using BrowserStack, validating rendering and interactivity across 25+ device configurations, ensuring consistency for millions of end users.
•	Collaborated with developers and product teams to implement BDD/TDD testing using Cucumber and Gherkin, embedding test automation at the earliest stages of software development.
•	Executed performance and stress tests on dynamic news dashboards to ensure fault tolerance and zero downtime during live election coverage.
•	Developed custom test reporting dashboards that visualized build stability, defect trends, and automation coverage metrics for executive QA reviews.

Senior SDET / QA Automation Engineer at CNN: 09/2019 - 04/2021
•	Collaborated with data science teams to integrate AI/ML services into production workflows, deploying Flask- and FastAPI-based microservices to power personalization, content categorization, and real-time learner analytics.
•	Designed and maintained queue-based architectures using Celery and Redis, orchestrating asynchronous processing pipelines for appointments, content recommendations, and background jobs—resulting in a 33% latency reduction during traffic spikes.
•	Led the architecture and delivery of a modular CMS platform using Django and PostgreSQL, with role-based publishing workflows and fine-grained permissions, scaling to over 500K monthly users with 62% faster content publishing cycles.
•	Optimized backend infrastructure with Redis caching and Cloudflare CDN, improving global API responsiveness by 320ms and achieving a 46% improvement in page load speeds under high concurrency.
•	Integrated role-based access control and multi-factor authentication (MFA) into an enterprise-grade EHR platform using Flask and MongoDB, securing sensitive medical records (HIPAA-compliant) for 200+ clinics and 1M+ patient records.
•	Automated CI/CD pipelines with Docker, GitHub Actions, and Kubernetes, enabling blue-green deployments, zero-downtime updates, and consistent delivery across staging, QA, and production environments.
•	Oversaw the full ML pipeline lifecycle, from data wrangling (pandas, NumPy) and model training (scikit-learn, TensorFlow) to inference serving via FastAPI with GPU-optimized deployments on AWS SageMaker and Lambda.

QA Engineer at Cox Automotive Inc: 02/2017 – 09/2019
•	Developed and maintained Selenium and WebdriverIO test frameworks in TypeScript, enabling full end-to-end coverage for the company’s Digital Retailing platform across browsers and devices.
•	Integrated automated testing into Jenkins pipelines with Docker-based environments, standardizing QA deployment and reducing environment inconsistency across teams.
•	Configured BrowserStack for scalable cloud-based UI validation, improving test execution parallelism and reducing infrastructure maintenance costs.
•	Designed API test automation scripts using Mocha, Chai, and Postman, verifying vehicle listing synchronization between services and third-party integrations.
•	Introduced parallel execution and distributed test orchestration, reducing suite runtime by over 50% and enabling daily test runs on feature branches.
•	Developed automated reporting tools to capture runtime metrics, coverage summaries, and CI trends for engineering leadership.
•	Partnered with DevOps teams to design automated deployment pipelines, aligning release and validation cycles for production deployments.

Software Developer at Fiserv: 04/2014 – 02/2017
•	Built extensible mobile test automation frameworks using Java, Appium, and Selenium Grid, supporting continuous validation of iOS and Android banking applications.
•	Automated the Google Play and Apple App Store submission pipeline, integrating build verification, code signing, and deployment workflows for over 30 financial institution apps.
•	Implemented data-driven regression testing for transaction workflows and account synchronization, improving defect detection by 45%.
•	Collaborated with developers to design reusable test hooks and APIs for faster test script creation and coverage extension.
•	Performed security validation and encryption compliance checks for financial data transfers, ensuring adherence to PCI-DSS standards.
•	Developed and maintained SQL-based test data management scripts, reducing environment preparation time by 70%.
•	Executed cross-platform compatibility testing across multiple OS versions and devices to maintain consistent functionality for end users.

QA Analyst Intern at Fiserv : 10/2011 – 09/2012
•	Assisted in manual and automated testing for early-stage mobile banking applications across iOS and Android platforms.
•	Developed initial Selenium test scripts for regression validation, contributing to the foundation of the automation framework later adopted by production teams.
•	Executed app store submission verifications and supported build validation for client-specific financial applications.
•	Tested app UI/UX for design consistency, responsiveness, and device compatibility.
•	Logged and tracked bugs in Jira, collaborating with development teams to ensure timely resolution and retesting.

Tech Support Intern at Southern Polytechnic State University : 09/2015 – 03/2017
•	Provided hands-on support in building and maintaining computer lab systems, performing hardware installations, BIOS configurations, and OS deployments.
•	Assisted in software imaging and setup of lab environments for IT and engineering courses, ensuring uniform system readiness across 10+ classrooms.
•	Troubleshot network connectivity issues, driver conflicts, and printer malfunctions, maintaining operational uptime for faculty and student labs.
•	Documented recurring technical issues and supported process improvement initiatives for the IT helpdesk.
•	Worked alongside senior IT staff to implement patch updates and system upgrades during maintenance windows.

Skills:

Node.js (Express, NestJS)
ASP.NET Core (C#)
Python (Flask)
Java (Spring Boot)
PHP (Laravel)
SQL
C++
React.js 
Angular
TypeScript
Redux
Responsive UI design
React Native
AngularJS
WebSockets
Unit Testing
Selenium
Cypress
Postman
PyTest
Robot Framework
TestNG
JUnit
Jest
Mocha
Playwright
Appium
Jenkins
GitLab CI/CD
Azure DevOps
Jira
Zephyr
QTest
SonarQube
AWS
Azure
GCP
ELK Stack
Terraform
Kubernetes
Docker
ISO 9001
HIPAA
PCI DSS
GDPR
FDA 21 CFR Part 11
Power BI
Excel
SQL Queries for Test Data
PostgreSQL
MySQL
MongoDB
REST APIs
GraphQL
JSON/XML Validation

Education:
Bachelor of Science, Information Technology (09/2006 – 03/2011)
Southern Polytechnic State University | USA
    `;
    // 3. Tailor resume with OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = buildPrompt(baseResume, jobDescription);

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_VERSION || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant for creating professional resume content.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 4096
    });

    const tailoredResume = completion.choices[0].message.content || '';

    if (!tailoredResume) {
      return new NextResponse(
        JSON.stringify({ error: 'Failed to generate tailored resume content' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Generate PDF
    const pdfBytes = await generateResumePdf(tailoredResume);

    // 5. Return PDF as response
    const fileBase = `Zain_Abdeen_${company.replace(/[^a-zA-Z0-9_]/g, '_')}_${role.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileBase}.pdf"`
      }
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}